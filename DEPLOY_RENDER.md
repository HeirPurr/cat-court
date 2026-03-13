# Render 上线步骤

## 你需要准备

1. 一个 GitHub 账号
2. 一个 Render 账号
3. 你的 `KIMI_API_KEY`

## 本项目已经准备好的内容

- `render.yaml`
- `requirements.txt`
- `.python-version`
- `server.py` 已支持公网监听
- `DB_PATH` 已支持挂到 Render 持久磁盘

## 你需要做的事

### 1. 把代码推到 GitHub

如果还没有远程仓库，先在 GitHub 新建一个空仓库，比如 `cat-court`。

然后在本地项目目录运行：

```bash
git remote add origin 你的仓库地址
git push -u origin main
```

仓库地址看起来一般像这样：

```bash
https://github.com/你的用户名/cat-court.git
```

### 2. 在 Render 里创建服务

1. 登录 Render
2. 连接 GitHub
3. 选择这个仓库
4. 选择使用仓库里的 `render.yaml`
5. 创建 Blueprint / Service

## Render 里要确认的设置

- 服务类型：`Web Service`
- 计划：`Starter`
- 持久磁盘挂载路径：`/var/data`
- 数据库文件路径：`/var/data/cat_court.db`
- 健康检查路径：`/`

## Render 里必须手动填写的环境变量

- `KIMI_API_KEY`

其它变量项目里已经写好了：

- `KIMI_BASE_URL=https://api.moonshot.cn/v1`
- `KIMI_MODEL=moonshot-v1-8k`
- `DB_PATH=/var/data/cat_court.db`

## 上线完成后

Render 会给你一个公开网址，格式大概像：

```text
https://cat-court.onrender.com
```

你和你男朋友都可以直接访问这个网址。

## 为什么不是免费计划

这个项目现在把记录存在 SQLite 里。为了让记录在重启或重新部署后不丢，需要 Render 的持久磁盘。持久磁盘只支持付费服务，所以这里用了 `Starter`。
