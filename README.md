# dsh-android-self

自己构建的 DeepSeek Harness Android 版：**不依赖 Termux、不用别人打好的包**。
一个 APK = Kotlin/Java 壳 + proot + 自建 Ubuntu arm64 rootfs（内含 Node 22 与 dsh）。

## 为什么是 proot + Ubuntu

dsh 是给 glibc Linux 写的：`node-pty` 等原生模块要编译，`@vscode/ripgrep` 没有 android 平台包，
bionic 上还要给每个原生依赖打补丁。套一层 glibc rootfs 后这些全部变成常规 Linux 问题。

## 关键设计

| 决策 | 值 | 原因 |
|---|---|---|
| `targetSdk` | **28** | Android 10 起 `targetSdk>=29` 禁止从可写数据目录 exec，而 proot/node 必须能 exec |
| `minSdk` | 26 | 覆盖 Android 8+，且 `java.nio.file` 从 26 才可用（解压符号链接要用） |
| rootfs | Ubuntu 24.04 base + Node 22.20 + `@deepseek-ai/dsh` | 官方 glibc arm64 包，免交叉编译 |
| 容器 | 静态 proot（termux fork） | 含 Android seccomp/SELinux 修补；静态链接省掉 libtalloc |
| rootfs 打包 | `tar.gz` + 自写解压器 | 不引 Apache Commons Compress；保留符号链接/硬链接/权限位 |
| 构建机 | GitHub Actions `ubuntu-24.04-arm` | 本机 x86_64 + 894MB，跑不动 arm64 rootfs 与 chroot |

## 目录

```
app/src/main/java/dev/self/dsh/
├─ MainActivity.java    WebView 容器 + 状态条 + 端口轮询
├─ EngineService.java   前台服务：解压 -> 起 proot -> 保活 -> 日志
├─ RootfsManager.java   assets 铺开（幂等，按版本戳）
├─ ProotLauncher.java   拼 proot 命令行
└─ TarGz.java           纯 JDK 的 tar.gz 解压器
scripts/
├─ build-rootfs.sh      chroot 里装 Node + dsh，打 rootfs.tar.gz
└─ build-proot.sh       编译静态 proot + loader
```

## 已验证

- `TarGz`：本地用 GNU 与 pax 两种 tar 格式实测，普通文件、目录、符号链接、硬链接（链接数=2）、
  可执行位（755）、>100 字符长路径、空目录全部正确还原。

## 未验证（要靠 CI 与真机）

- `termux/proot` 静态编译是否一次通过
- rootfs 里 `npm i -g @deepseek-ai/dsh` 的 node-pty 编译
- Android 10 真机上 proot 能否正常起 node
- 首次解压 250MB 的耗时

## 构建

推 `main` 或手动触发 `build-apk` workflow，产物在 Actions artifacts。
