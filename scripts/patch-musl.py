#!/usr/bin/env python3
"""让 termux/proot 的 GNUmakefile 能在 zig(musl) 工具链下编译。

两个问题：
1. zig 的链接驱动不认 `-Wl,-Ttext=0x...`（报 "unsupported linker arg"），
   而 proot 内嵌的 loader 必须链接到固定地址，所以改成 lld 的 `--Ttext=`；
2. loader 要用 `zig ld.lld` 直接链接（zig cc 不透传这些参数），
   主体仍用 zig cc，因此把链接器拆成独立变量 LOADER_LD。

用法: patch-musl.py <proot 源码根目录>
"""
import pathlib
import sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
p = root / "src/GNUmakefile"
s = p.read_text()

if "LOADER_LD ?=" in s:
    print("  跳过（已打过） src/GNUmakefile")
    sys.exit(0)

# 1) loader 用独立链接器变量
s = s.replace("LD       = $(CC)\n", "LD       = $(CC)\nLOADER_LD ?= $(LD)\n", 1)
# 2) -Wl,-Ttext=... -> --Ttext=...（lld 直接参数），顺带把逗号列表拆开
s = s.replace("-Wl$(BUILD_ID_NONE),-Ttext=$(LOADER_ADDRESS$1)$(ROSEGMENT),-z,noexecstack",
              "--Ttext=$(LOADER_ADDRESS$1)$(ROSEGMENT) -z noexecstack", 1)
# 3) loader 链接命令改用 LOADER_LD
s = s.replace("$$($$(quiet)LD) $1 -o $$@ $$^ $$(LOADER_LDFLAGS$1)",
              "$$(LOADER_LD) $1 -o $$@ $$^ $$(LOADER_LDFLAGS$1)", 1)

for anchor in ("LOADER_LD ?=", "--Ttext=", "$$(LOADER_LD) $1 -o"):
    if anchor not in s:
        sys.exit(f"patch 失败：GNUmakefile 里找不到 {anchor}")

p.write_text(s)
print("  patched src/GNUmakefile")
