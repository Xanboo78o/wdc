# ENGINE.md — should XBR move to Unity, Unreal or Godot?

Written 2026-09-28, in answer to: *"research how we can make it unity or
blender rather js lmaoooo bc if this is a real game it cant js be git or
javascript"*.

**Short answer:** switching engines is a real option, and there is a sensible
way to do it. Two parts of the question need fixing first, though, because
they change what the decision is actually about.

---

## 1. Three things to fix first

### Blender is not a game engine (not any more)

Blender *used* to include one, the Blender Game Engine. It was **removed in
Blender 2.80 (2018)** so the Blender team could focus on modelling, animation
and rendering, and they told people to use Godot instead
([Wikipedia: Blender Game Engine](https://en.wikipedia.org/wiki/Blender_Game_Engine)).
A fan fork called UPBGE still exists
([UPBGE 0.50](https://gamefromscratch.com/upbge-0-50-released-blender-game-engine-lives/)),
but no shipped sim racer uses it.

What Blender is really for, and you *will* want it: **building the 3D stuff.**
Car bodies, wheels, pit garages, grandstands, marshal posts, helmets. You
model them in Blender and export **glTF (.glb)** or **FBX**, and any engine
(three.js today, Unity/Unreal/Godot tomorrow) loads them. Blender is the
workshop. The engine is the racetrack.

### Git never goes away

Git isn't a kind of game. It's the **save history for your code**: every
commit is a checkpoint you can go back to. Every studio uses version control.
Unity and Godot teams mostly use git (plus Git LFS for big art files), and
Unreal and AAA teams often use Perforce, which does the same job for huge
binary files. If XBR moves to Unity tomorrow, `git commit` and `git push` stay
in your daily routine. GitHub Pages hosting is a different thing (it's just
where the browser version lives), and that part *would* change for a native
build, which goes to Steam instead.

### JavaScript doesn't stop something being a "real game"

Proof from Steam:

- **Vampire Survivors** first shipped on Steam built with **Phaser
  (JavaScript) wrapped in Electron**. It became a massive hit *before* they
  ported it to Unity in v1.6
  ([Wikipedia](https://en.wikipedia.org/wiki/Vampire_Survivors),
  [Phaser news](https://phaser.io/news/2024/02/vampire-survivors-space-54)).
- **CrossCode** shipped on Steam and consoles on a heavily modified
  **HTML5/impact.js** engine
  ([Radical Fish Games: architecture](https://www.radicalfishgames.com/?p=277)).

So JS isn't the thing holding XBR back. The real reasons to go native are
**specific**, and some of them do apply to a sim racer:

| Need | Browser | Native engine |
|---|---|---|
| Wheel **force feedback** | impossible (Gamepad API can only rumble), so you built `tools/ffb.py` | possible in-process (Windows: DirectInput / MOZA SDK) |
| Consoles (PS5 / Xbox / Switch) | no | yes (Unity, Unreal; Godot via a paid port) |
| Heavy graphics (rain, 22 detailed cars, night) | hard; WebGL has limits | much more headroom |
| Selling on Steam | yes, via Electron/Tauri wrapper | yes, natively |
| **Send a link, play in 3 seconds** | **yes, the killer feature** | no, has to be downloaded |

---

## 2. What XBR is right now (measured, not guessed)

- `js/` ≈ **18,700 lines** across ~40 modules. The biggest are `main.js`
  (1,572), `render.js` (1,471) and `physics.js` (1,064).
- **The sim core** (the part that *is* the game): `physics.js` 1,064 +
  `aero.js` 255 + `collide/race/autopilot/line/gearbox/pitstop` 2,233 ≈
  **3,550 lines**, plus `input.js` 423 (the driver's-hands model).
- `physics.js` has one law: *it may never import a renderer.* It only imports
  `aero.js`. It runs a **400 Hz fixed timestep** (`FIXED_DT = 1/400`) through an
  accumulator. **That law is what makes a port realistic.** You don't port a
  game, you port a pure maths module plus a thin shell around it.
- Tracks are **plain JSON** (`data/tracks/*.json`, 860 KB total). Monaco is a
  set of parallel arrays, 1,661 samples every 2 m: `x, y, w, bank, runL, runR,
  line`, plus `corners`, `drs`, `pit`, `sponsors`. Any engine can read that.
- The OSM/elevation bakers (`tools/bakereal.mjs`, `baketrack.mjs`,
  `getelev.mjs`, …) are **Node scripts that output data**. They never need to
  change engine. They just keep writing JSON.
- The FFB bridge `tools/ffb.py` talks to the wheel through the Linux kernel
  and to the game over a **localhost WebSocket**. Every engine below can open a
  WebSocket, so **the bridge works with any of them unchanged.**
- Your machine: **i7-8650U (4 cores), 16 GB RAM, GTX 1060 Mobile**, Arch
  (Omarchy/Hyprland). This matters a lot for one of the three engines (you'll
  see which).

---

## 3. The three engines, judged for *this* game

### What real sims actually use

| Sim | Engine |
|---|---|
| Assetto Corsa (2014) | Kunos' own custom engine |
| Assetto Corsa Competizione | **Unreal Engine 4**, with the AC physics model ported into it ([Wikipedia](https://en.wikipedia.org/wiki/Assetto_Corsa_Competizione), [Epic interview](https://www.unrealengine.com/en-US/developer-interviews/assetto-corsa-competizione-leans-into-realism-to-create-the-ultimate-racing-sim)) |
| Assetto Corsa EVO | Kunos' **new custom engine** (they left Unreal) ([Traxion](https://traxion.gg/why-assetto-corsa-2-will-use-a-brand-new-game-engine/)) |
| Automobilista 2 | Madness engine (licensed from Slightly Mad Studios) ([Wikipedia](https://en.wikipedia.org/wiki/Automobilista_2)) |
| KartKraft | **Unreal Engine 4** ([Wikipedia](https://en.wikipedia.org/wiki/KartKraft)) |
| Rennsport | **Unreal Engine 5** ([Wikipedia](https://en.wikipedia.org/wiki/Rennsport)) |
| iRacing, rFactor 2, Richard Burns Rally | custom in-house engines |

**The lesson:** every serious sim writes its **own tyre and vehicle physics**
and uses the engine only for graphics, sound, input and menus. ACC is the best
example: Kunos brought their own physics into Unreal. **You already work this
way.** `physics.js` is your "Kunos physics". The engine's built-in car physics
(Unity WheelCollider, Unreal Chaos Vehicles, Godot VehicleBody3D) would be
thrown away in all three cases.

(The big-name sims are custom or Unreal. Unity is everywhere in indie and
mobile racing, e.g. Mario Kart Tour, but I couldn't confirm a well-known
*hardcore* sim built on it, so I'm not going to claim one.)

### Side by side

| | **Unity 6** | **Unreal Engine 5** | **Godot 4.6** |
|---|---|---|---|
| Language | C# | C++ and Blueprint (visual) | GDScript (Python-ish) or C# |
| Cost | Free under **$200k/yr** revenue, then Pro $2,200/seat/yr. The Runtime Fee was **cancelled in Sept 2024** ([Unity blog](https://unity.com/blog/unity-is-canceling-the-runtime-fee), [CG Channel](https://www.cgchannel.com/2024/09/unity-scraps-controversial-runtime-fee-but-raises-prices/)) | Free until **$1M lifetime** gross, then **5% royalty** (3.5% if you also launch on the Epic Store) ([UE license](https://www.unrealengine.com/license), [CG Channel](https://www.cgchannel.com/2024/10/epic-games-to-cut-royalty-rate-on-unreal-engine-games/)) | **Free forever, MIT licence**, no royalties ever |
| Linux editor on *your* laptop | Officially only **Ubuntu 22.04/24.04 + GNOME** ([Unity 6.3 reqs](https://docs.unity3d.com/6000.3/Documentation/Manual/system-requirements.html)). Arch + Hyprland is unsupported, but it often works via the AUR `unityhub` | Linux build is a **~25 GB download (~43 GB unpacked)** ([ArchWiki](https://wiki.archlinux.org/title/Unreal_Engine_5)); Epic recommends **32 GB RAM, 8 GB VRAM** ([UE specs](https://dev.epicgames.com/documentation/en-us/unreal-engine/hardware-and-software-specifications-for-unreal-engine)). You have 16 GB / 6 GB and a 4-core U-series CPU: **expect very long shader compiles** | ~100 MB, `pacman -S godot`, runs great on Linux, first-class |
| 400 Hz custom physics | Easy: set `Time.fixedDeltaTime = 0.0025` or run your own accumulator in `Update()` | Doable in C++ (own accumulator or async physics tick); awkward in Blueprint | Easy: *Physics Ticks per Second* = 400, or own accumulator in `_process()` ([docs](https://docs.godotengine.org/en/4.6/tutorials/physics/using_jolt_physics.html)) |
| Wheel input | Input System reads wheels as joysticks | Raw input plugin | SDL3 joypads (recent) |
| Wheel **force feedback** | Not built in. Windows: MOZA SDK (C#!) or Logitech SDK / DirectInput assets ([Unity forum](https://discussions.unity.com/t/implementing-force-feedback-on-steering-wheels/889875)) | Not built in. Windows: MOZA SDK (C++) or plugins | Not built in yet ([PR #114642](https://github.com/godotengine/godot/pull/114642) is still a draft); `ffb.py` bridge works today |
| MOZA SDK | ✔ C# build ([MOZA SDK](https://mozaracing.com/pages/sdk)) | ✔ C++ build | via C# or GDExtension, **Windows only** |
| Steam | Steamworks.NET ([GitHub](https://github.com/rlabrecque/Steamworks.NET)) | built in | GodotSteam ([godotsteam.com](https://godotsteam.com/)) |
| Consoles | Best-supported | Best-supported | Via **W4 Consoles** (paid, by Godot's founders) ([W4](https://www.w4games.com/w4consoles), [Godot](https://godotengine.org/consoles/)) |
| **Also exports to the web?** | Yes (WebGL/WebGPU), builds are heavy | Not really | **Yes with GDScript**; C# projects **can't** export to web yet ([issue #70796](https://github.com/godotengine/godot/issues/70796)) |
| Learning curve for you | Medium. C# looks a lot like JS with types, and there are tons of tutorials | Steep. C++ is hard, Blueprint gets messy for maths-heavy sim code | Gentlest. GDScript reads almost like your JS, and the editor is small and fast |
| Graphics ceiling | High (HDRP/URP) | **Highest** (Lumen, Nanite) | Good, and improving; below the other two |

**A note on FFB, because it's your biggest reason to go native.** The MOZA SDK
is built for Windows (MSVC / .NET). On Linux, **no engine** gives you wheel FFB
today. Your `ffb.py` bridge (kernel `EVIOCSFF`) is honestly the best Linux
solution there is, and it works with every engine. So FFB is a reason to ship
a **Windows** build, not a reason to pick one engine over another.

### Verdicts

- **Unreal 5**: the ACC/Rennsport path and the best graphics, but it's the wrong
  tool *on this laptop*. 16 GB RAM, 4 cores and an unsupported distro would
  make every day slow and painful, and your sim code would have to be C++.
  Revisit if you ever have a big desktop and a team.
- **Unity 6**: the safe industry choice. C# is a comfortable jump from JS, the
  MOZA SDK ships a C# build, consoles are well supported, and it's free until
  $200k/year. Downsides: officially unsupported on Arch/Hyprland, and Unity has
  already tried to change its pricing on people once.
- **Godot 4**: the best fit for *you, now*. Free forever, native on Arch, light
  enough for your laptop, and GDScript is close to your JS. It's also the only
  one of the three that can **export the same project to the web** without
  bloat, which matters for section 5. Downsides: lower graphics ceiling, and
  consoles cost money via W4.

---

## 4. How to move without losing anything

The rule: **port the maths, reuse the data, keep the tools.**

### What moves, and how big it is

| Piece | Today | In the engine | Estimate |
|---|---|---|---|
| Sim core (`physics`, `aero`, `collide`, `race`, `autopilot`, `line`, `gearbox`, `pitstop`) | ~3,550 JS lines | C# (Unity/Godot) / GDScript (Godot) / C++ (Unreal) | **~3,800–4,500 lines**. Types add ~10–25%. It's a near line-by-line translation because nothing in it touches a screen |
| Driver's-hands input (`input.js`) | 423 | engine input + same maths | ~400–500 |
| Track loader | JSON arrays | one importer script: read `x,y,w,bank,runL,runR` and build the road mesh | ~200–400 |
| Rendering, HUD, menus (`render.js`, `main.js`, `forest.js`, `post.js`, …) | ~12,000 | **rebuilt with the engine's tools**, not translated | most of this gets *easier*: lighting, shadows, particles and post-FX are built in |
| OSM / elevation / aero bakers (`tools/*.mjs`) | Node | **stay Node**, keep writing JSON | 0 |
| FFB bridge (`tools/ffb.py`) | Python + WebSocket | unchanged. Engine opens `ws://localhost` | 0 (later: MOZA SDK for Windows players) |
| Headless harnesses (`drive.mjs`, `balance.mjs`, …) | Node | **keep them**. They become the *referee* for the port (see golden laps) | 0 |

### Golden laps: how you know the port is right

Your harnesses already drive laps with no screen. Record one: a fixed list of
steering/throttle/brake inputs → the car's position/speed every 0.1 s, saved as
CSV from Node. Feed the **same inputs** to the ported physics and compare. If
the lap time matches to within a few milliseconds, the port is right. This is
the *DESIGN.md* rule ("run `tools/drive.mjs` before touching physics numbers")
applied to a whole engine.

### Where it lives in git

Same repo, new folder: `native/` (the Godot/Unity project) next to `js/`,
`data/`, `tools/`. Both versions read the **same** `data/tracks/*.json`, so a
new OSM bake shows up in both. Put big art (`.blend`, `.fbx`, textures) under
**Git LFS**.

### Blender's real job

- Model the cars (F4 → F1, then GT3/NASCAR packs) → export **glTF** → load in
  any engine (three.js can load it *today*, so start now).
- Track-side props (grandstands, pit buildings, bridges) as reusable pieces.
- Keep the road itself **generated from the JSON**, not modelled by hand. The
  real-survey geometry is your edge; don't throw it away.

---

## 5. What the browser version is still great at

- **The share link.** For a build-in-public TikTok audience, "tap this, you're
  driving Monaco in 3 seconds" beats "download 2 GB" by a mile. That's your
  growth engine.
- **The free tier.** "Racing for all" + free F1 tier = a URL that works on a
  school Chromebook. No native build can match that.
- **Your test bench.** Node harnesses, instant reload, no compile step.

### The hybrid plan

| | Web (GitHub Pages) | Native (Steam, Windows + Linux) |
|---|---|---|
| Who | everyone, TikTok viewers, free players | people with wheels, paying players |
| What | F1 free tier, keyboard/gamepad, a few circuits | full sim: FFB, GT3/NASCAR/IndyCar/Rally/MotoGP packs, better graphics |
| Physics | same physics (JS today) | same physics (ported), checked with golden laps |

The cost of hybrid: **two copies of the physics to keep in sync.** Golden laps
keep that honest. (Later option: write the physics once in a language that
compiles to both WebAssembly and native, e.g. C++ or Rust. That's a big project
for later, not now.)

A cheap first step to Steam that needs **no engine switch**: wrap the current
game in **Electron or Tauri**, the Vampire Survivors route. The wrapper
could also start the FFB bridge by itself, so players never have to launch a
separate program.

---

## 6. Recommendation

**Don't rewrite yet. Finish the sim in JS, and when you port, port to Godot 4.**

Why:

1. **The sim is the product, and it isn't finished.** AI pace is still the open
   problem. Porting now means solving it twice. Every week spent in JS right now
   is a week of real progress. A week spent porting is a week of getting back
   to where you already are.
2. **You already did the hard part of "native later".** `physics.js` imports
   no renderer. That one rule turns a scary rewrite into a translation of about
   3,500 lines plus a new renderer.
3. **Godot fits you.** Free forever (no revenue cut, no pricing drama), runs
   natively on Arch, light enough for a 16 GB / 4-core laptop, GDScript is the
   closest thing to your JS, and it can still export to the web.
4. **Unity is the backup** if consoles or the MOZA C# SDK become the top
   priority. It's free until $200k/yr, but officially Ubuntu-only on Linux.
5. **Unreal isn't for this laptop.** It's the ACC path, but it wants 32 GB RAM
   and C++, and you have 16 GB and a 4-core laptop CPU.
6. **Keep the web version forever** as the free tier and the share link.

### A first week in Godot (a spike, not a switch)

A throwaway experiment in `native/`. The JS game keeps going on `master` the
whole time.

1. **Day 1.** `sudo pacman -S godot`. Do the official "Your first 3D game"
   tutorial, just to learn the editor.
2. **Day 2.** New project in `native/`. Write a script that reads
   `../data/tracks/monaco.json` and draws the road as a ribbon mesh from `x, y,
   w`. Seeing Monaco appear is the milestone.
3. **Day 3.** Port the *core* of `physics.js` (car spec, bicycle model, tyre
   curve, `step()`) to GDScript. Run it at 400 Hz with an accumulator in
   `_process()`, exactly like `main.js`.
4. **Day 4.** Keyboard + gamepad driving with a chase camera. Drive a lap.
5. **Day 5.** **Golden lap:** export a lap's inputs + trace from a Node
   harness as CSV, replay it in Godot, compare lap times. Fix until they match.
6. **Day 6.** Connect to `tools/ffb.py` over `WebSocketPeer` and feel the Moza
   in Godot.
7. **Day 7.** Model a simple car body in Blender, export `.glb`, drop it in.
   Then decide: does Godot feel better than the browser? Record the verdict in
   this file.

If the week goes well, you've proved the port path at no risk. If it doesn't,
you've lost one week and learned Godot and Blender, which is still a win.

---

### Sources

- Blender Game Engine removal: <https://en.wikipedia.org/wiki/Blender_Game_Engine> · UPBGE: <https://gamefromscratch.com/upbge-0-50-released-blender-game-engine-lives/>
- Unity Runtime Fee cancelled: <https://unity.com/blog/unity-is-canceling-the-runtime-fee> · pricing: <https://www.cgchannel.com/2024/09/unity-scraps-controversial-runtime-fee-but-raises-prices/> · <https://unity.com/products/pricing-updates>
- Unity 6.3 Linux editor requirements: <https://docs.unity3d.com/6000.3/Documentation/Manual/system-requirements.html>
- Unreal licence & royalty: <https://www.unrealengine.com/license> · <https://www.unrealengine.com/eula/unreal> · 3.5% Epic Store deal: <https://www.cgchannel.com/2024/10/epic-games-to-cut-royalty-rate-on-unreal-engine-games/>
- Unreal hardware: <https://dev.epicgames.com/documentation/en-us/unreal-engine/hardware-and-software-specifications-for-unreal-engine> · on Arch: <https://wiki.archlinux.org/title/Unreal_Engine_5>
- ACC on UE4: <https://en.wikipedia.org/wiki/Assetto_Corsa_Competizione> · <https://www.unrealengine.com/en-US/developer-interviews/assetto-corsa-competizione-leans-into-realism-to-create-the-ultimate-racing-sim>
- AC EVO custom engine: <https://traxion.gg/why-assetto-corsa-2-will-use-a-brand-new-game-engine/> · AMS2 Madness: <https://en.wikipedia.org/wiki/Automobilista_2> · KartKraft UE4: <https://en.wikipedia.org/wiki/KartKraft> · Rennsport UE5: <https://en.wikipedia.org/wiki/Rennsport>
- MOZA SDK (C++ / C#): <https://mozaracing.com/pages/sdk> · Unity FFB thread: <https://discussions.unity.com/t/implementing-force-feedback-on-steering-wheels/889875>
- Godot FFB PR (draft): <https://github.com/godotengine/godot/pull/114642> · Godot Jolt / physics ticks: <https://docs.godotengine.org/en/4.6/tutorials/physics/using_jolt_physics.html> · Godot C# web export: <https://github.com/godotengine/godot/issues/70796> · consoles: <https://godotengine.org/consoles/> · <https://www.w4games.com/w4consoles>
- Steam integration: <https://github.com/rlabrecque/Steamworks.NET> · <https://godotsteam.com/>
- JS games on Steam: <https://en.wikipedia.org/wiki/Vampire_Survivors> · <https://phaser.io/news/2024/02/vampire-survivors-space-54> · <https://www.radicalfishgames.com/?p=277>
- Linux wheel support tracker: <https://github.com/JacKeTUs/linux-steering-wheels>
