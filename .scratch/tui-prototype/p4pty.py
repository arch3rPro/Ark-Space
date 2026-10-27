import sys, os, json, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ptygrid import PTY

repo = "/root/Code/Ark-Space-usegpt-artifact-hub"
os.chdir(repo)
home = tempfile.mkdtemp(prefix="arks-p4-")
env = {"ARKSPACE_HOME": home, "ARKS_TUI": "v2", "LANG": "C", "LC_ALL": "C"}

def cfg():
    with open(os.path.join(home, "config.json")) as f: return json.load(f)

def insts():
    return [i["baseUrl"] for i in cfg().get("providers", {}).get("searxng", {}).get("instances", [])]

def add_url(url):
    p.send("a", 0.6)
    p.send(url, 0.3)
    p.send("ENTER", 0.3)   # finish typing
    p.send("CSS", 1.0)     # commit

p = PTY(env); p.pump(1.2)
p.expect("boot shows Exa strip", "Exa" in p.grid())
for _ in range(4): p.send("]")
p.pump(0.4)
g = p.grid()
p.expect("weknora page rows", "API endpoint" in g and "verify connection" in g and "default knowledge base" in g)
p.send("]")
g = p.grid()
p.expect("usegpt page rows", "Hub artifact store" in g and "Start services" in g and "Diagnose" in g)
for _ in range(4): p.send("DOWN")
p.send("ENTER", 1.2)
p.expect("diagnose reports issues", "configuration_incomplete" in p.grid())
p.send("["); p.send("[")   # back to searxng (context 3)
p.expect("searxng empty note", "no instances" in p.grid())
add_url("https://search.example.org")
g = p.grid()
p.expect("public add wrote instance", insts() == ["https://search.example.org"])
p.expect("public instance has no grants", cfg()["providers"]["searxng"]["instances"][0]["allowRanges"] == [])
# private endpoint -> CIDR gate; cancel is the default item
add_url("http://10.9.8.7:8080")
g = p.grid()
p.expect("cidr gate shows exact grant", "Authorize 10.9.8.7/32" in g and "Private network" in g)
p.send("ESC", 0.8)
p.expect("cancel default writes nothing", insts() == ["https://search.example.org"])
add_url("http://10.9.8.7:8080")
p.send("DOWN", 0.3)   # move onto the grant option
p.send("ENTER", 1.2)
sx = cfg()["providers"]["searxng"]["instances"]
p.expect("grant writes /32", len(sx) == 2 and [i for i in sx if i["baseUrl"] == "http://10.9.8.7:8080"][0]["allowRanges"] == ["10.9.8.7/32"])
# remove the private row with confirm -> yes
p.send("DOWN", 0.3)
p.send("d", 0.5)
p.expect("remove confirm names endpoint", "Remove this instance" in p.grid() or "10.9.8.7" in p.grid())
p.send("DOWN", 0.2); p.send("ENTER", 1.2)
p.expect("instance removed", len(insts()) == 1)
# weknora masked key entry never echoes plaintext
p.send("]", 0.6)
p.send("DOWN", 0.3)
p.send("ENTER", 0.6)
p.send("sk-topsecret-9f3a", 0.8)
g = p.grid()
p.expect("secret masked in form", "sk-topsecret-9f3a" not in g and "*" in g)
p.send("ESC", 0.6); p.send("ESC", 0.6)
p.expect("nothing written on cancel", "weknora" not in cfg().get("connections", {}))
p.send("q", 0.6); p.send("ENTER", 0.6)
p.expect("quit defaults to cancel (still running)", "?1049l" not in p.stream())
p.send("q", 0.6); p.send("DOWN", 0.2); p.send("ENTER", 1.0)
s = p.stream()
p.expect("exit restores terminal", all(x in s for x in ["?1049l", "?25h", "?2004l"]))
print("HOME:", home)
