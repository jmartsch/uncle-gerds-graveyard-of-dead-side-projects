# Uncle Gerd's Graveyard of Dead Side Projects

*Every developer has a graveyard. Uncle Gerd keeps mine as a pixel-art graveyard or a museum, and he can bring the dead back to life.*

A personal agent that lives on a [Fly.io Sprite](https://fly.io/sprites). It digs through your GitHub account for projects that have not seen a push in a year, turns each one into a tombstone in a walkable pixel-art graveyard (or a door in a museum), and lets Uncle Gerd – a grumpy but loving German uncle in a beige cardigan – comment on every one of them. Click **Revive** and the agent spawns a fresh Sprite, takes a checkpoint, and lets Claude Code try to bring the project back to life. If the patient flatlines, it restores the checkpoint and tries again. If it lives, it gets its own public URL.

Built for [Hacksgiving 2026](https://fly.io/hacksgiving/).

## How it works

```
Visitor ─▶ Sprite "ugm-museum" (public URL, sleeps when nobody visits)
           ├─ Web: Phaser hallway + rooms + a small Node API
           ├─ Curator: GitHub ─▶ dead repos ─▶ Jev (odds, mood) ─▶ Ollama Cloud (Uncle Gerd's lines) ─▶ data/exhibits.json
           └─ Revive: Sprites SDK ─▶ new Sprite "ugm-exhibit-<repo>"
                checkpoint ─▶ Claude Code headless ─▶ running? service + public URL : restore + second attempt
```

| Piece | Sprites feature or connector |
|---|---|
| Finding the dead | **GitHub connector**: repos, READMEs, last commits, open issues |
| Judging them | **TypeSafeAI connector** (Jev): revival odds, "worth it", and Uncle Gerd's mood as typed, calibrated decisions |
| Uncle Gerd's voice | **Ollama Cloud connector**: writes plaque, cause of death and commentary in the mood Jev picked |
| The surgeon | **Anthropic connector**: Claude Code on the exhibit Sprite talks to Claude without a key on that Sprite |
| The operating room | One **Sprite per exhibit**, **checkpoint** before surgery, **restore** after a failed attempt |
| Keeping it alive | Sprite **services** with `--http-port`, so a revived project wakes up whenever someone visits its URL |
| Staying awake | **Tasks API** holds the museum Sprite up while a scan or a revival runs |

Provider keys (GitHub, Ollama, TypeSafe, Anthropic) never touch a Sprite: every call goes through the Sprites gateway. The one secret on the museum Sprite is a Sprites token, needed to create the exhibit Sprites.

## Visit your own graveyard

Type any GitHub username into **Your graveyard** (or open `/u/<username>`). Uncle Gerd digs up that user's public repos that have not seen a push in a year, Jev judges them, Ollama writes the plaques, and the result is cached, so the next visit is instant. Guest museums are read-only: revivals stay reserved for the curator. Scans are queued (one at a time) and limited per hour (`GUEST_SCANS_PER_HOUR`, default 30).

## Run it locally (demo exhibits)

```bash
npm install
npm run dev            # http://localhost:8080 with demo exhibits and a simulated revival
```

To scan your real GitHub account locally, put `GITHUB_TOKEN=$(gh auth token)` (and optionally `OLLAMA_API_KEY`, `TYPESAFE_API_KEY`) into `.env` and run `npm run scan`. Without those keys Uncle Gerd falls back to his spare lines.

## Deploy to a Sprite

1. Install the [Sprites CLI](https://docs.fly.io/sprites/quickstart) and run `sprite login`.
2. In the Fly.io dashboard open **Sprites → Connectors** and add GitHub, Ollama Cloud, TypeSafeAI and Anthropic. Grant access with the name prefix `ugm-`.
3. Copy `.env.example` to `.env.sprite` and fill in `ADMIN_KEY` and `SPRITES_TOKEN`.
4. `./scripts/deploy.sh` – creates `ugm-museum`, uploads the code, runs it as a service and makes the URL public.
5. Check the connectors from inside the Sprite: `sprite exec -s ugm-museum -- bash -lc 'cd ~/museum && node scripts/check.js'`
6. Open `https://<your-sprite-url>/?key=<ADMIN_KEY>` once to enter curator mode, then **Rescan GitHub**.

## Notes

- Private repositories are never exhibited automatically, because the museum URL is public. Hand-pick them with `EXHIBIT_REPOS` if you really want to.
- Revivals run with `--dangerously-skip-permissions`, which is exactly why they happen on a disposable, hardware-isolated Sprite instead of your laptop.
- Deep links: `/#room=<exhibit-id>` opens a room directly.
- The graveyard starts in **SNES** style. Choose **8-BIT** at the top or press **B** for the original moonlit graveyard. The game remembers your choice. Link directly with `?theme=graveyard&style=8bit` or `?theme=graveyard&style=snes`. The **Museum** has its own button and URL (`?theme=museum`).

## Credits

Pixel art drawn in code. Fonts: Press Start 2P and VT323 (SIL Open Font License). Game engine: [Phaser](https://phaser.io).
