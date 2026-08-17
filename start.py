"""
MindCraft Dashboard
Usage: py start.py
"""

import subprocess
import sys
import os
import time
import threading
import msvcrt
from pathlib import Path
from collections import deque

ROOT = Path(__file__).resolve().parent
VIAPROXY_DIR = ROOT / "services" / "viaproxy"
VIAPROXY_JAR = VIAPROXY_DIR / "ViaProxy-3.4.13-SNAPSHOT.jar"
VIAPROXY_YML = VIAPROXY_DIR / "viaproxy.yml"
SETTINGS_JS = ROOT / "settings.js"
LOG_MAX = 300

# ---------------------------------------------------------------------------
# ANSI colors
# ---------------------------------------------------------------------------
RST = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[91m"
GRN = "\033[92m"
YEL = "\033[93m"
BLU = "\033[94m"
MAG = "\033[95m"
CYN = "\033[96m"
WHT = "\033[97m"

if os.name == "nt":
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
    except Exception:
        RST = BOLD = DIM = RED = GRN = YEL = BLU = MAG = CYN = WHT = ""

BANNER = f"""{CYN}{BOLD}
 ███╗   ███╗██╗███╗   ██╗███████╗██████╗  ██████╗ ████████╗████████╗███████╗██████╗
 ████╗ ████║██║████╗  ██║██╔════╝██╔══██╗██╔═══██╗╚══██╔══╝╚══██╔══╝██╔════╝██╔══██╗
 ██╔████╔██║██║██╔██╗ ██║█████╗  ██████╔╝██║   ██║   ██║      ██║   █████╗  ██████╔╝
 ██║╚██╔╝██║██║██║╚██╗██║██╔══╝  ██╔══██╗██║   ██║   ██║      ██║   ██╔══╝  ██╔══██╗
 ██║ ╚═╝ ██║██║██║ ╚████║███████╗██████╔╝╚██████╔╝   ██║      ██║   ███████╗██║  ██║
 ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚══════╝╚═════╝  ╚═════╝    ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═╝{RST}"""

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
COMMANDS = [
    "start all", "stop all", "dashboard",
    "server start", "server stop",
    "via start", "via stop",
    "set server", "set port", "set auth", "set version", "set via target",
    "logs", "logs via", "logs server",
    "help", "clear", "exit",
]


# ---------------------------------------------------------------------------
# Input with tab completion (msvcrt)
# ---------------------------------------------------------------------------
def prompt_input(prompt_str):
    """Read a line with Tab completion using msvcrt (Windows)."""
    sys.stdout.write(f"{BOLD}{CYN}{prompt_str}>{RST} ")
    sys.stdout.flush()
    buf = ""
    while True:
        ch = msvcrt.getwch()
        if ch in ('\r', '\n'):
            sys.stdout.write('\n')
            return buf
        elif ch == '\b':
            if buf:
                buf = buf[:-1]
                sys.stdout.write('\b \b')
                sys.stdout.flush()
        elif ch == '\x03':
            raise KeyboardInterrupt
        elif ch == '\t':
            matches = [c for c in COMMANDS if c.startswith(buf)]
            if len(matches) == 1:
                completion = matches[0][len(buf):]
                buf = matches[0]
                sys.stdout.write(completion + ' ')
                sys.stdout.flush()
            elif len(matches) > 1:
                # show options, reprint prompt
                sys.stdout.write('\n  ' + '  '.join(f"{CYN}{m}{RST}" for m in matches))
                sys.stdout.write(f"\n{BOLD}{CYN}mindcraft>{RST} {buf}")
                sys.stdout.flush()
        elif ch in ('\x00', '\xe0'):
            # arrow keys / function keys — skip second byte
            msvcrt.getwch()
        else:
            buf += ch
            sys.stdout.write(ch)
            sys.stdout.flush()


# ---------------------------------------------------------------------------
# Process manager
# ---------------------------------------------------------------------------
class ManagedProcess:
    def __init__(self, name, cmd, cwd=None):
        self.name = name
        self.cmd = cmd
        self.cwd = cwd
        self.proc = None
        self.running = False
        self.logs = deque(maxlen=LOG_MAX)
        self.started_at = None

    def start(self):
        if self.running:
            return False, f"{self.name} already running."
        try:
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            self.proc = subprocess.Popen(
                self.cmd, cwd=self.cwd, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, bufsize=1,
                creationflags=flags,
            )
            self.running = True
            self.started_at = time.time()
            self.logs.clear()
            threading.Thread(target=self._reader, daemon=True).start()
            return True, f"{self.name} started (pid {self.proc.pid})."
        except FileNotFoundError:
            return False, f"Not found: {self.cmd[0]}"
        except Exception as e:
            return False, str(e)

    def stop(self):
        if not self.running:
            return False, f"{self.name} not running."
        try:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            self.running = False
            self.logs.append("[stopped]")
            return True, f"{self.name} stopped."
        except Exception as e:
            return False, str(e)

    def uptime_str(self):
        if not self.running or not self.started_at:
            return ""
        up = int(time.time() - self.started_at)
        h, rem = divmod(up, 3600)
        m, s = divmod(rem, 60)
        return f"{h}h{m:02d}m" if h else f"{m}m{s:02d}s"

    def _reader(self):
        try:
            for line in self.proc.stdout:
                line = line.rstrip("\n\r")
                if line:
                    self.logs.append(line)
        except Exception:
            pass
        finally:
            self.running = False


# ---------------------------------------------------------------------------
# Settings helpers
# ---------------------------------------------------------------------------
def read_settings():
    out = {}
    text = SETTINGS_JS.read_text(encoding="utf-8")
    for line in text.splitlines():
        s = line.strip()
        if s.startswith('"') and ":" in s:
            key = s.split(":")[0].strip('"')
            val = s.split(":", 1)[1].strip().rstrip(",").strip()
            out[key] = val
    return out


def write_settings_key(key, value):
    lines = SETTINGS_JS.read_text(encoding="utf-8").splitlines(keepends=True)
    out = []
    for line in lines:
        s = line.strip()
        if s.startswith(f'"{key}"'):
            indent = line[: len(line) - len(line.lstrip())]
            line = f'{indent}"{key}": {value},\n'
        out.append(line)
    SETTINGS_JS.write_text("".join(out), encoding="utf-8")


def read_viaproxy_target():
    text = VIAPROXY_YML.read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.strip().startswith("target-address:"):
            return line.split(":", 1)[1].strip()
    return "?"


def write_viaproxy_target(addr):
    lines = VIAPROXY_YML.read_text(encoding="utf-8").splitlines(keepends=True)
    out = []
    for line in lines:
        if line.strip().startswith("target-address:"):
            line = f"target-address: {addr}\n"
        out.append(line)
    VIAPROXY_YML.write_text("".join(out), encoding="utf-8")


# ---------------------------------------------------------------------------
# Find Java
# ---------------------------------------------------------------------------
def find_java():
    candidates = [
        r"C:\Users\pana\AppData\Local\Polyfrost\OneClient\data\metadata\java"
        r"\OpenJDK25U-jdk_x64_windows_hotspot_25.0.4_7\jdk-25.0.4+7\bin\java.exe",
        "java",
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return "java"

JAVA = find_java()


# ---------------------------------------------------------------------------
# UI helpers
# ---------------------------------------------------------------------------
def cls():
    os.system("cls" if os.name == "nt" else "clear")

def hline(char="─", width=62):
    return f"  {DIM}{char * width}{RST}"

def status_dot(running):
    return f"{GRN}●{RST}" if running else f"{RED}○{RST}"

def cmd_output(proc, n=30):
    lines = list(proc.logs)[-n:]
    if not lines:
        return [f"  {DIM}(no output){RST}"]
    return [f"  {DIM}│{RST} {l}" for l in lines]


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
def print_dashboard(via, ms):
    cls()
    print(BANNER)
    print()

    settings = read_settings()
    host = settings.get("host", "?").strip('"')
    port = settings.get("port", "?")
    auth = settings.get("auth", "?").strip('"')
    version = settings.get("minecraft_version", "?").strip('"')
    via_target = read_viaproxy_target()

    print(f"  {BOLD}SERVICES{RST}")
    print(hline())

    vdot = status_dot(via.running)
    if via.running:
        vinfo = f"{GRN}RUNNING{RST}  pid {via.proc.pid}  up {via.uptime_str()}"
    else:
        vinfo = f"{RED}STOPPED{RST}"
    print(f"  {vdot} {BOLD}ViaProxy{RST}     {vinfo}")

    mdot = status_dot(ms.running)
    if ms.running:
        minfo = f"{GRN}RUNNING{RST}  pid {ms.proc.pid}  up {ms.uptime_str()}"
    else:
        minfo = f"{RED}STOPPED{RST}"
    print(f"  {mdot} {BOLD}MindServer{RST}   {minfo}")

    print(hline())
    print()

    print(f"  {BOLD}CONFIG{RST}")
    print(hline())
    print(f"  Server      {CYN}{host}:{port}{RST}")
    print(f"  Auth        {CYN}{auth}{RST}")
    print(f"  Version     {CYN}{version}{RST}")
    print(f"  ViaProxy    {CYN}{via_target}{RST}  (proxy → server)")
    print(f"  Dashboard   {CYN}http://localhost:{settings.get('mindserver_port', 8081)}{RST}")
    print(hline())
    print(f"  {DIM}Type 'help' for commands | Tab for autocomplete{RST}")
    print()


def print_help():
    print()
    print(f"  {BOLD}COMMANDS{RST}")
    print(hline())
    print(f"  {GRN}dashboard{RST}                Start ViaProxy + MindServer + open UI")
    print(f"  {GRN}start all{RST}                Start ViaProxy + MindServer")
    print(f"  {GRN}stop all{RST}                 Stop everything")
    print()
    print(f"  {YEL}server start{RST}             Start MindServer (bots)")
    print(f"  {YEL}server stop{RST}              Stop MindServer")
    print()
    print(f"  {YEL}via start{RST}                Start ViaProxy")
    print(f"  {YEL}via stop{RST}                 Stop ViaProxy")
    print()
    print(f"  {CYN}set server <addr:port>{RST}   Change target server")
    print(f"  {CYN}set port <port>{RST}          Change target port")
    print(f"  {CYN}set auth <offline|online>{RST}  Change auth mode")
    print(f"  {CYN}set version <ver>{RST}        Change MC version (auto/26.2)")
    print(f"  {CYN}set via target <addr:port>{RST}  Change ViaProxy backend")
    print()
    print(f"  {MAG}logs{RST} [via|server] [n]    Show last n log lines")
    print(f"  {DIM}clear{RST}                    Refresh dashboard")
    print(f"  {DIM}help{RST}                     Show this help")
    print(f"  {DIM}exit{RST}                     Stop all and quit")
    print(hline())
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    via = ManagedProcess("ViaProxy", [JAVA, "-jar", str(VIAPROXY_JAR)], cwd=str(VIAPROXY_DIR))
    ms = ManagedProcess("MindServer", ["node", "main.js"], cwd=str(ROOT))

    print_dashboard(via, ms)

    try:
        while True:
            try:
                raw = prompt_input("mindcraft").strip()
            except (EOFError, KeyboardInterrupt):
                raw = "exit"

            if not raw:
                print_dashboard(via, ms)
                continue

            parts = raw.split(maxsplit=1)
            cmd = parts[0].lower()
            arg = parts[1].strip() if len(parts) > 1 else ""

            if cmd in ("exit", "quit", "q"):
                print(f"\n  {YEL}Shutting down...{RST}")
                via.stop()
                ms.stop()
                print(f"  {GRN}Goodbye!{RST}")
                break

            elif cmd == "clear":
                print_dashboard(via, ms)

            elif cmd == "help":
                print_help()

            # ── dashboard: start all + open browser ──
            elif cmd == "dashboard":
                ok, msg = via.start()
                print(f"  {msg}")
                time.sleep(1)
                ok, msg = ms.start()
                print(f"  {msg}")
                time.sleep(1)
                settings = read_settings()
                port = settings.get("mindserver_port", 8081)
                import webbrowser
                webbrowser.open(f"http://localhost:{port}")
                print(f"  {GRN}Opened http://localhost:{port} in browser{RST}")
                time.sleep(1)
                print_dashboard(via, ms)

            # ── start all (no browser) ──
            elif cmd == "start" and arg == "all":
                ok, msg = via.start()
                print(f"  {msg}")
                time.sleep(1)
                ok, msg = ms.start()
                print(f"  {msg}")
                time.sleep(1)
                print_dashboard(via, ms)

            elif cmd == "stop" and arg == "all":
                ok, msg = ms.stop()
                print(f"  {msg}")
                ok, msg = via.stop()
                print(f"  {msg}")
                print_dashboard(via, ms)

            elif cmd == "via" and arg:
                action = arg.lower()
                if action == "start":
                    ok, msg = via.start()
                    print(f"  {msg}")
                    time.sleep(2)
                    print_dashboard(via, ms)
                elif action == "stop":
                    ok, msg = via.stop()
                    print(f"  {msg}")
                    print_dashboard(via, ms)
                else:
                    print(f"  {RED}Usage: via start | via stop{RST}")

            elif cmd == "server" and arg:
                action = arg.lower()
                if action == "start":
                    ok, msg = ms.start()
                    print(f"  {msg}")
                    time.sleep(1)
                    print_dashboard(via, ms)
                elif action == "stop":
                    ok, msg = ms.stop()
                    print(f"  {msg}")
                    print_dashboard(via, ms)
                else:
                    print(f"  {RED}Usage: server start | server stop{RST}")

            elif cmd == "set":
                if not arg:
                    print(f"  {RED}Usage: set server | set port | set auth | set version | set via target{RST}")
                    continue

                set_parts = arg.split(maxsplit=1)
                key = set_parts[0].lower()
                val = set_parts[1] if len(set_parts) > 1 else ""

                if key == "server":
                    if not val:
                        val = input(f"  Server address: ").strip()
                    if val:
                        write_settings_key("host", f'"{val}"')
                        print(f"  {GRN}Server set to {val}{RST}")
                    print_dashboard(via, ms)

                elif key == "port":
                    if not val:
                        val = input(f"  Port: ").strip()
                    if val:
                        write_settings_key("port", val)
                        print(f"  {GRN}Port set to {val}{RST}")
                    print_dashboard(via, ms)

                elif key == "auth":
                    if not val:
                        val = input(f"  Auth mode (offline/online): ").strip()
                    if val in ("offline", "online"):
                        write_settings_key("auth", f'"{val}"')
                        print(f"  {GRN}Auth set to {val}{RST}")
                    else:
                        print(f"  {RED}Must be 'offline' or 'online'{RST}")
                    print_dashboard(via, ms)

                elif key == "version":
                    if not val:
                        val = input(f"  MC version (auto/1.21.4/26.2/etc): ").strip()
                    if val:
                        write_settings_key("minecraft_version", f'"{val}"')
                        print(f"  {GRN}Version set to {val}{RST}")
                    print_dashboard(via, ms)

                elif key == "via":
                    if not val:
                        print(f"  {RED}Usage: set via target <address:port>{RST}")
                        continue
                    via_parts = val.split(maxsplit=1)
                    if via_parts[0].lower() == "target":
                        addr = via_parts[1] if len(via_parts) > 1 else ""
                        if not addr:
                            addr = input(f"  ViaProxy target address: ").strip()
                        if addr:
                            write_viaproxy_target(addr)
                            print(f"  {GRN}ViaProxy target set to {addr}{RST}")
                    print_dashboard(via, ms)

                else:
                    print(f"  {RED}Unknown setting: {key}{RST}")

            elif cmd == "logs":
                target = "server"
                n = 30
                if arg:
                    arg_parts = arg.split()
                    if arg_parts[0] in ("via", "proxy"):
                        target = "via"
                    elif arg_parts[0] in ("server", "ms", "mind"):
                        target = "server"
                    if len(arg_parts) > 1:
                        try:
                            n = int(arg_parts[1])
                        except ValueError:
                            pass
                proc = via if target == "via" else ms
                print(f"  {BOLD}--- {proc.name} (last {n} lines) ---{RST}")
                for line in cmd_output(proc, n):
                    print(line)
                print(f"  {BOLD}--- end ---{RST}")
                print()

            else:
                print(f"  {RED}Unknown command: {raw}{RST}")
                print(f"  {DIM}Type 'help' for commands{RST}")

    except Exception as e:
        print(f"\n  {RED}Fatal: {e}{RST}")
    finally:
        via.stop()
        ms.stop()


if __name__ == "__main__":
    main()
