# Box Radio

EnsoCode 侧栏插件：浏览、搜索、收藏并收听互联网电台。

v1 数据源为 [Radio Browser](https://api.radio-browser.info/)（免 key 公共目录），只播 HTTP MP3/AAC 直播流。设计见 [docs/design.md](docs/design.md)。

## 安装

1. 打开 EnsoCode → 设置 → 插件 → Enso plugins
2. 从文件夹安装 `D:\code\box-radio`
3. 启用 **Box Radio**
4. 任意会话右侧栏「+」→ Box Radio

## 开发

`ash
node --test
`

零 npm 依赖。改完后在插件行点「从来源重新安装」。

许可证：MIT。