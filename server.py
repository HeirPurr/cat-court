import json
import os
import re
import sqlite3
import time
import traceback
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error, parse, request


ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"
DB_PATH = Path(os.environ.get("DB_PATH", ROOT / "cat_court.db"))
ACTIVE_CASE_RE = re.compile(r"^/api/active-cases/(\d{4,6})(?:/(submit|judge|archive))?$")


SEED_RECORDS = [
    {
        "id": "seed-1",
        "date": "2026-03-12",
        "title": "深夜消息已读不回案",
        "coffeeText": "我发了好多条消息，你一直没回，我越等越慌，也会觉得自己是不是不被重视。",
        "gameText": "我当时真的在开会，手机静音了。结束后看到消息已经很多，不是不想回。",
        "winner": "game",
        "severity": "low",
        "verdict": "本轮更占理的一边是游戏猫猫，因为这次延迟回复有现实原因，但也需要更早补一句说明。",
        "analysis": "猫猫法官觉得，咖啡猫猫的担心是真实的，但这次核心不是冷落，而是信息没及时同步。游戏猫猫略胜，不过以后需要更及时报平安。",
        "reason_summary": ["开会属于合理原因", "担心是真实情绪", "后续沟通仍需补位"],
        "coffeeAdvice": "你已经把担心说出来了，下一次可以把“我担心你”说得更靠前一点，少一点猜测，会更容易被接住。",
        "gameAdvice": "如果临时忙起来，哪怕只补一句“我晚点回你”，也能让对方安心很多。",
    },
    {
        "id": "seed-2",
        "date": "2026-03-12",
        "title": "冰美式到底算不算正餐案",
        "coffeeText": "我觉得喝冰美式已经够了，你还一直说我没吃饭，让我有点烦。",
        "gameText": "你空腹只喝咖啡真的会不舒服，我提醒你不是想管你，是怕你胃疼。",
        "winner": "game",
        "severity": "medium",
        "verdict": "本轮游戏猫猫更占理，因为担心身体这件事比嘴硬更重要。",
        "analysis": "猫猫法官认为，这次争执表面上像是饮食习惯，实际是一个在关心，一个在逞强。提醒方式可以更柔和，但关心本身站得住脚。",
        "reason_summary": ["关心身体是正向动机", "表达方式略直", "逞强会放大情绪"],
        "coffeeAdvice": "如果你其实也知道对方是在关心，可以先接住那份好意，再表达自己不喜欢被催的方式。",
        "gameAdvice": "",
    },
    {
        "id": "seed-3",
        "date": "2026-03-10",
        "title": "周末到底先出门还是先打副本案",
        "coffeeText": "周末本来说好一起出门，结果你又说先打一把，我会觉得约会总被排在后面。",
        "gameText": "我只是想把已经约好的副本打完，不是故意不陪你，我以为晚一点出门也没关系。",
        "winner": "coffee",
        "severity": "medium",
        "verdict": "本轮咖啡猫猫更占理，因为已经说好的陪伴安排，不该总被临时往后挪。",
        "analysis": "猫猫法官看下来，游戏猫猫并不是不想陪伴，而是低估了“优先级被往后放”的受伤感。咖啡猫猫这次赢在诉求更明确。",
        "reason_summary": ["既定约定更应优先", "副本可协调", "被延后会带来失落"],
        "coffeeAdvice": "",
        "gameAdvice": "如果你知道一件事可能会撞到约定，最好提前提出来一起商量，而不是临时改时间。",
    },
]


def load_env(path):
    values = {}

    if not path.exists():
        return values

    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip()

    return values


ENV = load_env(ENV_PATH)
for env_key, env_value in ENV.items():
    os.environ.setdefault(env_key, env_value)

KIMI_API_KEY = os.environ.get("KIMI_API_KEY", "")
KIMI_BASE_URL = os.environ.get("KIMI_BASE_URL", "https://api.moonshot.cn/v1").rstrip("/")
KIMI_MODEL = os.environ.get("KIMI_MODEL", "moonshot-v1-8k")
PORT = int(os.environ.get("PORT", "3000"))
HOST = os.environ.get("HOST", "0.0.0.0")
KIMI_MAX_RETRIES = 3


SYSTEM_PROMPT = """
你是一只公平、温柔、略带戏剧感的猫猫法官。
你的任务是阅读双方吵架陈述，输出一份轻量裁决。

规则：
1. 你必须在 coffee 和 game 两边里选择一边作为 winner，不允许平局。
2. 胜利等级只能是 low、medium、high、overwhelming 之一。
3. 语气可以有猫猫风格，但结论必须清楚、简洁、公平。
4. 不要编造双方没有提到的事实。
5. 如果双方都很有道理，也必须选出“本轮更占理的一边”，并在分析里说明只是本轮略胜。
6. 只输出 JSON，不要输出 Markdown，不要加代码块。

JSON Schema:
{
  "winner": "coffee | game",
  "severity": "low | medium | high | overwhelming",
  "verdict": "string",
  "analysis": "string",
  "title": "string",
  "reason_summary": ["string", "string", "string"],
  "coffee_advice": "string",
  "game_advice": "string"
}
""".strip()


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def today_str():
    return datetime.now().date().isoformat()


def db_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def build_active_title(code):
    return f"{code} 号猫猫案件"


def make_history_id(code):
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    return f"active-{code}-{stamp}"


def validate_side(side):
    if side not in {"coffee", "game"}:
        raise ValueError("Side must be coffee or game.")
    return side


def validate_code(code):
    digits = re.sub(r"\D", "", str(code))
    if len(digits) < 4 or len(digits) > 6:
        raise ValueError("案件码必须是 4 到 6 位数字。")
    return digits


def init_db():
    db_exists = DB_PATH.exists()

    with db_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cases (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                title TEXT NOT NULL,
                coffee_text TEXT NOT NULL,
                game_text TEXT NOT NULL,
                winner TEXT NOT NULL,
                severity TEXT NOT NULL,
                verdict TEXT NOT NULL,
                analysis TEXT NOT NULL,
                reason_summary TEXT NOT NULL,
                coffee_advice TEXT NOT NULL DEFAULT '',
                game_advice TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )

        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(cases)").fetchall()
        }

        if "coffee_advice" not in columns:
            conn.execute("ALTER TABLE cases ADD COLUMN coffee_advice TEXT NOT NULL DEFAULT ''")

        if "game_advice" not in columns:
            conn.execute("ALTER TABLE cases ADD COLUMN game_advice TEXT NOT NULL DEFAULT ''")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS active_cases (
                code TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                date TEXT NOT NULL,
                status TEXT NOT NULL,
                coffee_text TEXT NOT NULL DEFAULT '',
                game_text TEXT NOT NULL DEFAULT '',
                coffee_submitted_at TEXT NOT NULL DEFAULT '',
                game_submitted_at TEXT NOT NULL DEFAULT '',
                winner TEXT NOT NULL DEFAULT '',
                severity TEXT NOT NULL DEFAULT '',
                verdict TEXT NOT NULL DEFAULT '',
                analysis TEXT NOT NULL DEFAULT '',
                reason_summary TEXT NOT NULL DEFAULT '[]',
                coffee_advice TEXT NOT NULL DEFAULT '',
                game_advice TEXT NOT NULL DEFAULT '',
                judged_at TEXT NOT NULL DEFAULT '',
                archived_at TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )

        count = conn.execute("SELECT COUNT(*) AS count FROM cases").fetchone()["count"]
        if count == 0 and not db_exists:
            for record in SEED_RECORDS:
                insert_case(conn, record, created_at=f"{record['date']}T12:00:00")


def insert_case(conn, case_record, created_at=None):
    conn.execute(
        """
        INSERT OR REPLACE INTO cases (
            id, date, title, coffee_text, game_text, winner, severity,
            verdict, analysis, reason_summary, coffee_advice, game_advice, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            case_record["id"],
            case_record["date"],
            case_record["title"],
            case_record["coffeeText"],
            case_record["gameText"],
            case_record["winner"],
            case_record["severity"],
            case_record["verdict"],
            case_record["analysis"],
            json.dumps(case_record.get("reason_summary", []), ensure_ascii=False),
            case_record.get("coffeeAdvice", ""),
            case_record.get("gameAdvice", ""),
            created_at or now_iso(),
        ),
    )


def row_to_case(row):
    return {
        "id": row["id"],
        "date": row["date"],
        "title": row["title"],
        "coffeeText": row["coffee_text"],
        "gameText": row["game_text"],
        "winner": row["winner"],
        "severity": row["severity"],
        "verdict": row["verdict"],
        "analysis": row["analysis"],
        "reason_summary": json.loads(row["reason_summary"] or "[]"),
        "coffeeAdvice": row["coffee_advice"] or "",
        "gameAdvice": row["game_advice"] or "",
        "created_at": row["created_at"],
    }


def list_cases():
    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM cases
            ORDER BY date DESC, created_at DESC, id DESC
            """
        ).fetchall()
    return [row_to_case(row) for row in rows]


def create_case(case_record):
    with db_connection() as conn:
        insert_case(conn, case_record)
        conn.commit()


def delete_case(case_id):
    with db_connection() as conn:
        cursor = conn.execute("DELETE FROM cases WHERE id = ?", (case_id,))
        conn.commit()
        return cursor.rowcount > 0


def get_active_case(conn, code):
    return conn.execute("SELECT * FROM active_cases WHERE code = ?", (code,)).fetchone()


def create_or_get_active_case(code):
    code = validate_code(code)
    created_at = now_iso()

    with db_connection() as conn:
        row = get_active_case(conn, code)

        if not row:
            conn.execute(
                """
                INSERT INTO active_cases (
                    code, title, date, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    code,
                    build_active_title(code),
                    today_str(),
                    "collecting",
                    created_at,
                    created_at,
                ),
            )
            conn.commit()
            row = get_active_case(conn, code)

        return row


def serialize_active_case(row, side):
    validate_side(side)
    other_side = "game" if side == "coffee" else "coffee"
    own_submitted = bool(row[f"{side}_submitted_at"])
    other_submitted = bool(row[f"{other_side}_submitted_at"])
    all_submitted = own_submitted and other_submitted
    reveal_other = row["status"] in {"judged", "archived"}

    return {
        "code": row["code"],
        "title": row["title"],
        "date": row["date"],
        "status": row["status"],
        "side": side,
        "submitted": {
            "coffee": bool(row["coffee_submitted_at"]),
            "game": bool(row["game_submitted_at"]),
        },
        "allSubmitted": all_submitted,
        "ownText": row[f"{side}_text"] or "",
        "otherText": row[f"{other_side}_text"] if reveal_other else "",
        "result": {
            "winner": row["winner"],
            "severity": row["severity"],
            "verdict": row["verdict"],
            "analysis": row["analysis"],
            "reason_summary": json.loads(row["reason_summary"] or "[]"),
            "coffeeAdvice": row["coffee_advice"] or "",
            "gameAdvice": row["game_advice"] or "",
        },
        "judgedAt": row["judged_at"] or "",
        "archivedAt": row["archived_at"] or "",
    }


def fetch_active_case_snapshot(code, side):
    code = validate_code(code)
    validate_side(side)

    with db_connection() as conn:
        row = get_active_case(conn, code)
        if not row:
            return None
        return serialize_active_case(row, side)


def update_active_submission(code, side, content):
    code = validate_code(code)
    side = validate_side(side)
    submitted_at = now_iso()
    text_column = f"{side}_text"
    submitted_column = f"{side}_submitted_at"

    with db_connection() as conn:
        row = get_active_case(conn, code)
        if not row:
            raise LookupError("case_not_found")

        if row["status"] in {"judged", "archived"}:
            raise RuntimeError("这场案件已经完成宣判，不能再改陈词了。")

        conn.execute(
            f"""
            UPDATE active_cases
            SET {text_column} = ?, {submitted_column} = ?, status = ?, updated_at = ?
            WHERE code = ?
            """,
            (
                content,
                submitted_at,
                "collecting",
                submitted_at,
                code,
            ),
        )

        refreshed = get_active_case(conn, code)
        new_status = "ready" if refreshed["coffee_submitted_at"] and refreshed["game_submitted_at"] else "collecting"
        conn.execute(
            """
            UPDATE active_cases
            SET status = ?, updated_at = ?
            WHERE code = ?
            """,
            (new_status, submitted_at, code),
        )
        conn.commit()
        return get_active_case(conn, code)


def judge_active_case(code):
    code = validate_code(code)

    with db_connection() as conn:
        row = get_active_case(conn, code)
        if not row:
            raise LookupError("case_not_found")

        if row["status"] == "archived":
            raise RuntimeError("这场案件已经封存，不能再重新开庭了。")

        if not row["coffee_submitted_at"] or not row["game_submitted_at"]:
            raise RuntimeError("双方都还没提交完成，暂时不能开庭。")

        result = call_kimi_api(row["coffee_text"], row["game_text"])
        judged_at = result.get("judged_at", now_iso())
        title = (result.get("title") or "").strip() or row["title"] or build_active_title(code)

        conn.execute(
            """
            UPDATE active_cases
            SET title = ?, status = ?, winner = ?, severity = ?, verdict = ?, analysis = ?,
                reason_summary = ?, coffee_advice = ?, game_advice = ?, judged_at = ?, updated_at = ?
            WHERE code = ?
            """,
            (
                title,
                "judged",
                result["winner"],
                result["severity"],
                result["verdict"],
                result["analysis"],
                json.dumps(result.get("reason_summary", []), ensure_ascii=False),
                result.get("coffeeAdvice", ""),
                result.get("gameAdvice", ""),
                judged_at,
                judged_at,
                code,
            ),
        )
        conn.commit()
        return get_active_case(conn, code)


def archive_active_case(code):
    code = validate_code(code)

    with db_connection() as conn:
        row = get_active_case(conn, code)
        if not row:
            raise LookupError("case_not_found")

        if row["status"] != "judged":
            raise RuntimeError("这场案件还没正式宣判，暂时不能封存。")

        insert_case(
            conn,
            {
                "id": make_history_id(code),
                "date": row["date"],
                "title": row["title"],
                "coffeeText": row["coffee_text"],
                "gameText": row["game_text"],
                "winner": row["winner"],
                "severity": row["severity"],
                "verdict": row["verdict"],
                "analysis": row["analysis"],
                "reason_summary": json.loads(row["reason_summary"] or "[]"),
                "coffeeAdvice": row["coffee_advice"] or "",
                "gameAdvice": row["game_advice"] or "",
            },
            created_at=row["judged_at"] or now_iso(),
        )

        archived_at = now_iso()
        conn.execute(
            """
            UPDATE active_cases
            SET status = ?, archived_at = ?, updated_at = ?
            WHERE code = ?
            """,
            ("archived", archived_at, archived_at, code),
        )
        conn.commit()
        return get_active_case(conn, code)


def extract_json(text):
    text = text.strip()

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def build_payload(coffee_text, game_text):
    user_prompt = f"""
请阅读以下两边的陈述，进行一次“猫猫法官”风格的轻量裁决。

咖啡猫猫的陈述：
{coffee_text}

游戏猫猫的陈述：
{game_text}

请严格按照指定 JSON 返回。
""".strip()

    return {
        "model": KIMI_MODEL,
        "temperature": 0.7,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    }


def call_kimi_api(coffee_text, game_text):
    if not KIMI_API_KEY:
        raise RuntimeError("KIMI_API_KEY is not configured.")

    payload = build_payload(coffee_text, game_text)
    raw = None
    last_error = None

    for attempt in range(KIMI_MAX_RETRIES):
        req = request.Request(
            f"{KIMI_BASE_URL}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {KIMI_API_KEY}",
            },
            method="POST",
        )

        try:
            with request.urlopen(req, timeout=60) as response:
                raw = response.read().decode("utf-8")
                last_error = None
                break
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            parsed_detail = {}

            try:
                parsed_detail = json.loads(detail)
            except json.JSONDecodeError:
                parsed_detail = {}

            error_message = (
                parsed_detail.get("error", {}).get("message")
                if isinstance(parsed_detail, dict)
                else ""
            ) or detail
            error_type = (
                parsed_detail.get("error", {}).get("type")
                if isinstance(parsed_detail, dict)
                else ""
            ) or ""

            is_overloaded = exc.code == 429 or "overloaded" in error_type or "overloaded" in error_message.lower()
            last_error = exc

            if is_overloaded and attempt < KIMI_MAX_RETRIES - 1:
                time.sleep(1.1 * (attempt + 1))
                continue

            if is_overloaded:
                raise RuntimeError("小咪判官今天案子有点多，刚刚没抢到开庭时间。稍等片刻，再点一次【开庭】就好。") from exc

            raise RuntimeError(f"Kimi API 暂时没有顺利回应：HTTP {exc.code}。请稍后再试。") from exc
        except error.URLError as exc:
            last_error = exc
            if attempt < KIMI_MAX_RETRIES - 1:
                time.sleep(1.1 * (attempt + 1))
                continue
            raise RuntimeError("小咪判官暂时没连上外面的法庭线路，请稍后再试。") from exc

    if raw is None:
        raise RuntimeError("小咪判官暂时还没缓过来，请稍后再试一次。") from last_error

    data = json.loads(raw)
    choices = data.get("choices") or []

    if not choices:
        raise RuntimeError("Kimi API returned no choices.")

    message = choices[0].get("message") or {}
    content = message.get("content")

    if isinstance(content, list):
        content = "".join(
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and item.get("type") in {"text", "output_text"}
        )

    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("Kimi API returned an empty message.")

    result = extract_json(content)

    winner = result.get("winner")
    severity = result.get("severity")
    verdict = result.get("verdict")
    analysis = result.get("analysis")
    title = result.get("title")
    reason_summary = result.get("reason_summary")
    coffee_advice = result.get("coffee_advice")
    game_advice = result.get("game_advice")

    if winner not in {"coffee", "game"}:
        raise RuntimeError("Kimi API returned an invalid winner.")

    if severity not in {"low", "medium", "high", "overwhelming"}:
        raise RuntimeError("Kimi API returned an invalid severity.")

    if not isinstance(verdict, str) or not verdict.strip():
        raise RuntimeError("Kimi API returned an invalid verdict.")

    if not isinstance(analysis, str) or not analysis.strip():
        raise RuntimeError("Kimi API returned an invalid analysis.")

    if not isinstance(title, str) or not title.strip():
        title = "今日猫猫判决"

    if not isinstance(reason_summary, list):
        reason_summary = []

    if not isinstance(coffee_advice, str):
        coffee_advice = ""

    if not isinstance(game_advice, str):
        game_advice = ""

    cleaned_reasons = [str(item).strip() for item in reason_summary if str(item).strip()][:3]

    return {
        "winner": winner,
        "severity": severity,
        "verdict": verdict.strip(),
        "analysis": analysis.strip(),
        "title": title.strip(),
        "reason_summary": cleaned_reasons,
        "coffeeAdvice": coffee_advice.strip(),
        "gameAdvice": game_advice.strip(),
        "model": KIMI_MODEL,
        "judged_at": now_iso(),
    }


class CatCourtHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length).decode("utf-8")

        try:
            return json.loads(raw_body or "{}")
        except json.JSONDecodeError as exc:
            raise ValueError("Request body must be valid JSON.") from exc

    def do_GET(self):
        parsed = parse.urlparse(self.path)
        active_match = ACTIVE_CASE_RE.match(parsed.path)

        if parsed.path == "/api/records":
            self._send_json({"records": list_cases()})
            return

        if active_match and active_match.group(2) is None:
            query = parse.parse_qs(parsed.query)
            side = str((query.get("side") or [""])[0]).strip()

            try:
                snapshot = fetch_active_case_snapshot(active_match.group(1), side)
            except ValueError as exc:
                self._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return

            if snapshot is None:
                self._send_json({"error": "这个案件码还没有人进来过。"}, HTTPStatus.NOT_FOUND)
                return

            self._send_json(snapshot)
            return

        return super().do_GET()

    def do_POST(self):
        parsed = parse.urlparse(self.path)
        active_match = ACTIVE_CASE_RE.match(parsed.path)

        if parsed.path == "/api/judge":
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return

            coffee_text = str(body.get("coffee", "")).strip()
            game_text = str(body.get("game", "")).strip()

            if not coffee_text or not game_text:
                self._send_json({"error": "Both coffee and game statements are required."}, HTTPStatus.BAD_REQUEST)
                return

            try:
                result = call_kimi_api(coffee_text, game_text)
            except RuntimeError as exc:
                self._send_json({"error": str(exc)}, HTTPStatus.BAD_GATEWAY)
                return
            except Exception as exc:
                traceback.print_exc()
                self._send_json(
                    {"error": f"Unexpected server error while calling the judge: {exc}"},
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
                return

            self._send_json(result, HTTPStatus.OK)
            return

        if parsed.path == "/api/records":
            try:
                body = self._read_json_body()
            except ValueError as exc:
                self._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return

            case_record = {
                "id": str(body.get("id", "")).strip(),
                "date": str(body.get("date", "")).strip(),
                "title": str(body.get("title", "")).strip(),
                "coffeeText": str(body.get("coffeeText", "")).strip(),
                "gameText": str(body.get("gameText", "")).strip(),
                "winner": str(body.get("winner", "")).strip(),
                "severity": str(body.get("severity", "")).strip(),
                "verdict": str(body.get("verdict", "")).strip(),
                "analysis": str(body.get("analysis", "")).strip(),
                "reason_summary": body.get("reason_summary", []),
                "coffeeAdvice": str(body.get("coffeeAdvice", "")).strip(),
                "gameAdvice": str(body.get("gameAdvice", "")).strip(),
            }

            if not case_record["id"] or not case_record["date"] or not case_record["title"]:
                self._send_json({"error": "Case id, date, and title are required."}, HTTPStatus.BAD_REQUEST)
                return

            if case_record["winner"] not in {"coffee", "game"}:
                self._send_json({"error": "Case winner is invalid."}, HTTPStatus.BAD_REQUEST)
                return

            if case_record["severity"] not in {"low", "medium", "high", "overwhelming"}:
                self._send_json({"error": "Case severity is invalid."}, HTTPStatus.BAD_REQUEST)
                return

            if not isinstance(case_record["reason_summary"], list):
                self._send_json({"error": "Case reason_summary must be an array."}, HTTPStatus.BAD_REQUEST)
                return

            create_case(case_record)
            self._send_json({"ok": True}, HTTPStatus.CREATED)
            return

        if parsed.path == "/api/active-cases/join":
            try:
                body = self._read_json_body()
                code = validate_code(body.get("code", ""))
                side = validate_side(str(body.get("side", "")).strip())
            except ValueError as exc:
                self._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return

            row = create_or_get_active_case(code)
            self._send_json(serialize_active_case(row, side), HTTPStatus.OK)
            return

        if active_match:
            code = active_match.group(1)
            action = active_match.group(2)

            try:
                body = self._read_json_body()
                side = validate_side(str(body.get("side", "")).strip())
            except ValueError as exc:
                self._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return

            if action == "submit":
                content = str(body.get("content", "")).strip()
                if not content:
                    self._send_json({"error": "陈词不能为空。"}, HTTPStatus.BAD_REQUEST)
                    return

                try:
                    row = update_active_submission(code, side, content)
                except LookupError:
                    self._send_json({"error": "这个案件码还不存在。"}, HTTPStatus.NOT_FOUND)
                    return
                except RuntimeError as exc:
                    self._send_json({"error": str(exc)}, HTTPStatus.CONFLICT)
                    return

                self._send_json(serialize_active_case(row, side), HTTPStatus.OK)
                return

            if action == "judge":
                try:
                    row = judge_active_case(code)
                except LookupError:
                    self._send_json({"error": "这个案件码还不存在。"}, HTTPStatus.NOT_FOUND)
                    return
                except RuntimeError as exc:
                    self._send_json({"error": str(exc)}, HTTPStatus.CONFLICT)
                    return
                except Exception as exc:
                    traceback.print_exc()
                    self._send_json({"error": str(exc)}, HTTPStatus.BAD_GATEWAY)
                    return

                self._send_json(serialize_active_case(row, side), HTTPStatus.OK)
                return

            if action == "archive":
                try:
                    row = archive_active_case(code)
                except LookupError:
                    self._send_json({"error": "这个案件码还不存在。"}, HTTPStatus.NOT_FOUND)
                    return
                except RuntimeError as exc:
                    self._send_json({"error": str(exc)}, HTTPStatus.CONFLICT)
                    return

                self._send_json(serialize_active_case(row, side), HTTPStatus.OK)
                return

        self._send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        parsed = parse.urlparse(self.path)

        if not parsed.path.startswith("/api/records/"):
            self._send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)
            return

        case_id = parse.unquote(parsed.path.split("/api/records/", 1)[1]).strip()
        if not case_id:
            self._send_json({"error": "Case id is required."}, HTTPStatus.BAD_REQUEST)
            return

        deleted = delete_case(case_id)
        if not deleted:
            self._send_json({"error": "Case not found."}, HTTPStatus.NOT_FOUND)
            return

        self._send_json({"ok": True}, HTTPStatus.OK)


def run():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), CatCourtHandler)
    print(f"Cat Court running at http://127.0.0.1:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    run()
