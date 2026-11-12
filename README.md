# Box Radio

EnsoCode 侧栏插件：浏览、搜索、收藏并收听互联网电台。

v1 数据源为 [Radio Browser](https://api.radio-browser.info/)（免 key 公共目录），只播 HTTP MP3/AAC 直播流。设计见 [docs/design.md](docs/design.md)。

## 安装

1. 打开 EnsoCode → 设置 → 插件 → Enso plugins
2. 从文件夹安装 `D:\code\box-radio`
3. 启用 **Box Radio**
4. 任意会话右侧栏「+」→ Box Radio

## 开发

```bash
node --test
```

播放用 mpg123 wasm 流式解码。从 Git 安装前在本目录执行 `npm ci`。改完后在插件行点「从来源重新安装」。

许可证：MIT。
