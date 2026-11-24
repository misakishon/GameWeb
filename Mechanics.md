# ⚔️ 2D Sumi-e Samurai — Game Mechanics & Systems Design Document (`Mechanics.md`)

> **Document Version**: `v1.0` (Covers **Live Build `ac58db5`** + **v2.0 Gameplay Expansion Spec**)  
> **Genre**: 2D Bird's-Eye (`2.5D` Standing Perspective) Action-Exploration & Kenjutsu Sandbox  
> **Art & Feel Direction**: Hand-Inked Japanese Sumi-e Brushwork & Mineral-Wash Cartography (`60–120 FPS` Procedural Rig + Verlet Cloth)  
> **Primary Codebase Touchpoints**: `src/Samurai2DPlatformer.tsx`, `src/samuraiRig.ts`, `src/continents.ts`, `src/SamuraiPovShop.tsx`, `src/FullWorldMapModal.tsx`

---

## 1. Design Pillars

Every current and future mechanic in this game is evaluated against four non-negotiable pillars:

1. **Living Brushstroke Tactility**: Every movement, slash, arrow loose, and cloth billow must feel like wet sumi ink striking textured washi paper—crisp anticipation, decisive impact frames, and readable calligraphic trails.
2. **Seamless 5-Continent Wanderlust**: All five continents coexist in one continuous open world (`4,840 × 4,840` world units). Players choose freely between scenic overland road travel and instant cartographic teleportation without loading screens.
3. **Readable, Skill-Rewarding Combat**: Hitboxes, swing arcs, projectile trajectories, and obstacle collisions are honest `1:1` geometry—never hidden RNG. Positioning, combo timing, and weapon switching (`Katana ↔ Yumi Bow`) reward mastery.
4. **Cohesive Economy & Tangibility**: Every Gold coin earned on the field translates into visible, physical changes on the Samurai's rig (scarves, hats, cloaks, blades, bows, magnetic auras) sold across Master Kenji's continent outposts.

---

## 2. Core Gameplay Loops

### Moment-to-Moment Loop (`0–30 seconds`)
- **Action**: Move (`WASD`), Sprint/Dash (`Shift` / `Space`), and chain 4-move Katana combos or loose Yumi Bow arrows (`Click` / `J`), swapping weapons on the fly (`Q`).
- **Feedback**: Sub-stepped collision response, directional calligraphic ink arcs, spark bursts, footstep dust, `120Hz` billowing cloak/scarf physics, and floating `+GOLD` / strike callouts.
- **Reward**: Immediate Gold Koban pickups, sliced Tameshigiri target bounties (`+25 Gold`), and kinetic flow satisfaction.

### Session Loop (`5–20 minutes`)
- **Goal**: Explore across the **5 Continents** (by walking the cardinal stone roads or teleporting via the Full World Map `[M]`), harvest regional Gold & bounties, and visit Master Kenji's outposts (`[E]`).
- **Tension**: Managing arrow quiver supply, navigating solid environmental hazards (non-walkable Koi Ponds, Glacial Lakes, Molten Magma Calderas, dense tree groves), and optimizing Focus Rush (`18s`) windows.
- **Resolution**: Unlocking and equipping the full suite of Master Kenji's weapons, charms, and garments, transforming the Ronin's speed, reach, dash recovery, and visual silhouette.

### Long-Term Expedition & Progression Loop (`v2.0 Core Game Flow`)
1. **Start in Tier I Sanctuary (`Kyoto Shrine Courtyard`, `-3900, +650`)**: Far-away continents (`Tier II` → `Tier V`, up to `8,950 px` away across a `12,800 × 9,600` world!) begin **Undiscovered (`🔒 Locked Wayshrine`)**.
2. **Hunt Regional Enemies & Gather Monster Trade Loot**: Defeat local & roadside enemies to collect regional materials (*Straw Talisman*, *Scorpion Carapace*, *Venom Sac*, *Frost Core*, *Obsidian Heart*).
3. **Trade Loot for Gold & Upgrade Gear at Master Kenji's Stall**: Sell monster drops at the trading counter for Gold Coins, then **upgrade Katana Forge Tiers, Armor/Resolve Seals, Dash Boots, and Yumi Bow Power**.
4. **survive the Overland Expedition Trails**: Trek along the 6 winding wildland roads and rest at **Midway Waystation Camps** to survive tougher enemy patrols and reach the next Continent's Plaza—permanently unlocking its **Teleport Wayshrine**!

---

## 3. Controls & Input Map

| Action | Primary Input | Alternate Input | Notes |
| :--- | :--- | :--- | :--- |
| **Move (360°)** | `W / A / S / D` | `Arrow Keys` / On-screen D-Pad | Smooth velocity damping; auto-rotates character heading |
| **Sprint Toggle** | `Shift` (Hold) | HUD `Sprint: ON/OFF` | Base walk `155 px/s` → Sprint `330 px/s` (before gear buffs) |
| **Kaze Dash** | `Space` | HUD `Dash` Button | High-speed burst along current heading + afterimage trail |
| **Primary Attack** | `Left-Click` (Cursor Aim) | `J / Z / K / X` or HUD Button | 4-hit **Katana** combo OR **Yumi Bow** shot toward cursor |
| **Weapon Switch Skill** | `Q` | HUD `Switch [Q]` Button | Unlocks permanently upon buying **Yumi War Bow** |
| **Interact / Shop** | `E` | Click Merchant Stall on Map | Opens Master Kenji's 1st-person counter shop within radius |
| **Full World Map** | `M` | Click Top-Right Minimap | Opens full 5-continent map; click anywhere to teleport |
| **Fast Continent Teleport** | `1` – `5` | Top-Left `TELEPORT` Bar | Teleports directly to Continent `1–5` central plaza |
| **Re-Center Origin** | `R` | — | Resets Samurai to `(0, 0)` Kyoto Shrine Courtyard |
| **Proposed: Ink Parry** *(v2.0)* | `Right-Click` | `F` | `[PROPOSED]` `0.18s` timed deflect window + counter-slash |

---

## 4. Shipped Core Mechanics (`v1.2` Live Implementation)

### 4.1 Locomotion, Kaze Dash & Cloth Physics
- **Purpose**: Make simple traversal across courtyards, bridges, and inter-continental roads feel fluid, weighty, and responsive.
- **Movement Parameters**:
  - **Walk Speed**: `155 px/s` (`accel = 14.5`)
  - **Sprint Speed**: `330 px/s` (`accel = 13.0`)
  - **Gear & Elixir Multipliers**:
    - `Crimson Wind Scarf`: `×1.18` movement speed
    - `Focus Tea Flask` (`18s` buff): `×1.22` movement speed (`×1.4396` stacked!)
- **Kaze Dash (`Space`)**:
  - **Standard**: `680 px/s` impulse, `0.16s` duration, `0.36s` cooldown, spawns `8` foot-dust particles + dash afterimages.
  - **With `Gale Straw Hat`**: `820 px/s` impulse, `0.20s` duration, `0.18s` cooldown (`50%` faster recovery).
  - **With `Shadow Cloak`**: Spawns high-density charcoal phantom afterimages every `0.02s` (`0.32s` fade).
- **Sub-Stepped World Collision**:
  - Player collider radius: `14 px`.
  - Movement is sub-stepped in `≤ 8 px` increments per frame so high-speed `820 px/s` dashes never tunnel through thin bridge railings, trees, or shorelines.

---

### 4.2 4-Move Kenjutsu Katana Combo System
- **Purpose**: Replace repetitive single-swing hacking with an expressive, rhythmic 4-stage martial arts sequence where each strike has distinct reach, width, lunge, and visual silhouette.
- **Combo Window**: `1.25s` (`slashComboReset`). Attacking before expiry advances `(variant + 1) % 4`; pausing resets cleanly to Strike 1.
- **Minimum Refire Gate**: `0.09s` remaining (`0.05s` during **Focus Rush**).

| Combo Stage | Move Name | Duration | Forward Lunge | OBB Length (Std / Moonlight) | OBB Half-Width (Std / Moonlight) | Visual Signature |
| :-: | :--- | :-: | :-: | :-: | :-: | :--- |
| **`0`** | **Forehand Cross-Cut** | `0.27s` | `+140 px/s` | `88 px` / `114 px` | `38 px` / `48 px` | Wide sweeping horizontal ink crescent |
| **`1`** | **Rising Backhand Uppercut** | `0.27s` | `+140 px/s` | `88 px` / `114 px` | `38 px` / `48 px` | Inverted reverse-hand upward arc |
| **`2`** | **Overhead Helm-Splitter** | `0.34s` | `+175 px/s` | `94 px` / `118 px` | `30 px` / `38 px` | High vertical downward cleave + ground shockwave ring |
| **`3`** | **Piercing Forward Thrust** | `0.30s` | `+250 px/s` | `118 px` / `142 px` | `22 px` / `28 px` | Two-handed needle lance + dual sonic shock rings |

- **Edge Cases**:
  - Clicking anywhere on the canvas aims the Samurai immediately toward the cursor angle before computing the Oriented Bounding Box (`OBB`), guaranteeing accurate 360° directional targeting.

---

### 4.3 Yumi War Bow & Weapon Switch Skill (`[Q]`)
- **Purpose**: Introduce ranged precision, resource management (arrows), and melee-to-ranged stance switching.
- **Unlock Condition**: Purchasing **Yumi War Bow** (`65 Gold`) in Master Kenji's Shop grants `+10` starter arrows and permanently unlocks `[Q]` **Weapon Switch**.
- **Ballistics & Tuning**:
  - **Projectile Speed**: `760 px/s` (`920 px/s` during **Focus Rush**).
  - **Fire Cooldown**: `0.25s` (`0.14s` during **Focus Rush**).
  - **Max Flight Lifetime**: `1.4s` (`~1,064 px` standard range).
  - **Obstacle Blocking**: Arrows terminate with spark bursts on solid tree/cactus trunks, rocks, stone lanterns, gate pillars, and Merchant Stalls, while flying cleanly over low water/magma surfaces!
- **Failure State**: Attempting to fire at `0 Arrows` triggers a `0.28s` dry-fire lockout and displays `"OUT OF ARROWS! Buy Arrows in Shop [E]"` without consuming cooldowns unfairly.

---

### 4.4 Vast Asymmetric 5-Continent Expedition World (`12,800 × 9,600`)
- **World Geometry & Edge-to-Edge Forests**: Massive `[-6400, +6400] × [-4800, +4800]` open-world expedition map blanketed in **~1,700+ biome-authentic real trees** (indexed in a `256 px` `O(1)` spatial hash grid for locked `60–120 FPS`), **18 Wilderness Water & Magma Pools** (forest ponds, desert oases, glacial tarns, jungle lagoons, molten vents), **6 winding Bezier overland routes**, and **6 Midway Waystation Camps**.
- **10 Unrecognized Ancient Statues (`?` Mystery Task Relics)**:
  - Scattered in hidden forest & lakeside clearings across Tiers I–V (`Weathered Monk`, `Kitsune Idol`, `Sunstone Obelisk`, `Vine Sentinel`, `Horned Oni Altar`).
  - Appear as **`?` Unknown Statues** until the player approaches and presses **`[E]` (or Clicks)** to awaken a **24s Ancient Trial Task**—summoning **3 Cursed Spirit Effigies** around the glade. Shattering all 3 with Katana or Yumi Bow reveals the statue's true name, ignites its permanent golden aura (`★`), and awards **`+65 to +175 Gold`**.
- **Wayshrine Discovery Progression (`Hard-to-Reach Continents`)**:
  - Players begin at **Tier I: Kyoto Shrine Courtyard `(-3900, +650)`**.
  - The 4 outer continents (**Tier II** through **Tier V**, up to `9,000 px` away!) start **Locked / Undiscovered (`🔒`)**. Players must **fight, trade loot, upgrade gear, and trek the overland trails on foot** to reach a continent's Wayshrine (`620 px` radius) before Fast-Teleport unlocks permanently for that region!

| Key | Tier | Continent | World Origin | Distance from Kyoto | Recommended Loadout | Liquid Body |
| :-: | :-: | :--- | :-: | :-: | :--- | :--- |
| **`1`** | **Tier I** | **Kyoto Shrine Courtyard** | `(-3900, +650)` | `0m` *(Spawn)* | Starter Katana | **Koi Pond** |
| **`2`** | **Tier II** | **Sunstone Dune Oasis** | `(-1050, +2750)` | `~3,540m SE` | Crimson Scarf + Gale Hat | **Desert Oasis** |
| **`3`** | **Tier III** | **Jade Monsoon Basin** | `(+2150, +1750)` | `~6,150m E-SE` | Yumi War Bow + Magnet Bell | **Emerald Lagoon** |
| **`4`** | **Tier IV** | **Frostpeak Snow Sanctuary** | `(-450, -2950)` | `~4,985m NE` | Moonlight Sword + Shadow Cloak | **Glacial Lake** |
| **`5`** | **Tier V** | **Obsidian Ember Caldera** | `(+4650, -2150)` | `~8,995m ENE` | Full Masterwork + Focus Tea | **Molten Caldera** |

- **Zoomable & Pannable Full-View World Map (`[M]` or Click Minimap)**:
  - Supports **Mouse-Wheel Zoom (`1.0×` → `4.5×`)** and **Click-Drag Pan** to inspect the entire 5-continent world, winding routes, Waystations, Tier badges, distances, and miniature botanical trees, plus a **Scout Mode** toggle for testing instant teleports.

---

## 5. Proposed v2.0 Gameplay Mechanics (Next Implementation Phase)

> **Note**: Numerical values marked `[PLACEHOLDER]` are initial balance hypotheses to be playtested and tuned once implemented.

### 5.1 Mechanic: Ki Spirit Gauge & Timely Ink-Parry (`Just-Deflect`)
- **Purpose**: Elevate combat from pure offense into an authentic samurai duel of spacing, patience, and split-second timing.
- **Player Fantasy**: Standing motionless as an enemy blade or arrow hurtles in, tapping deflect at the last instant to part the attack in a flash of crimson ink, and cutting down the staggered foe in one stroke.
- **Input**: `Right-Click` or `F` (Deflect Stance) · consumes `1 Ki Pip` on miss, refunds `+1 Ki Pip` on **Just-Deflect**.
- **Parameters**:
  - **Ki Gauge**: `3 Pips` (`1.4s` `[PLACEHOLDER]` passive regeneration per pip; dashing or deflecting uses `1 Pip`).
  - **Just-Deflect Window**: `0.00s – 0.18s` `[PLACEHOLDER]` from input press.
  - **Standard Block Window**: `0.18s – 0.42s` `[PLACEHOLDER]` (halves incoming knockback, no counter-crit).
  - **Recovery Vulnerability**: `0.22s` `[PLACEHOLDER]` if whiffed completely.
- **Output on Success**:
  1. Time-dilates (`hitstop`) for `0.06s` with a concentric sumi-e shockwave ring and metallic chime visual cue.
  2. Enemy melee attacker is **Staggered** (`1.5s` `[PLACEHOLDER]`); incoming enemy arrows are **Reflected** back along the Samurai's aim angle at `1.3×` speed!
  3. Pressing `Attack` within `0.6s` triggers an instant **Iai Counter-Slash** (`2.0×` `[PLACEHOLDER]` damage, guaranteed critical ink splash).
- **Edge Cases**:
  - Simultaneous multi-hit attacks during a successful `Just-Deflect` grant `0.30s` of follow-up parry immunity (`auto-parry chain`) so crowds feel exhilarating rather than unfair.
  - Cannot initiate Deflect during the first `0.10s` of a heavy Overhead Cleave; **can** cancel standard Walk/Sprint immediately.

---

### 5.2 Mechanic: Kyudo Draw-and-Hold (`Charged Piercing Arrow`)
- **Purpose**: Give the **Yumi War Bow** skill-expressive depth beyond tap-firing and reward positioning across bridges and choke points.
- **Player Fantasy**: Drawing the asymmetrical bamboo bow taut while cloak hems whip in the wind, then loosing a single whistling arrow that skewers an entire line of targets.
- **Input**: Hold `Left-Click` or `J` for `0.55s` `[PLACEHOLDER]` while **Yumi War Bow** is active, then release.
- **Output**:
  - Movement slows to `55%` `[PLACEHOLDER]` while drawing; an ink sight-line converges along the cursor vector.
  - Fires a **Piercing Gale Arrow** (`1,180 px/s` `[PLACEHOLDER]`, consumes `1 Arrow`) that **pierces through up to 4 soft targets** (`2.0×` `[PLACEHOLDER]` damage) before stopping only on solid stone/tree obstacles.
- **Emergent Elemental Interactions**:
  - Shooting an arrow directly over a **Volcanic Brazier / Molten Caldera** ignites it into an **Ember Arrow** (leaves burning ash trail, `+50%` `[PLACEHOLDER]` bonus damage vs. Frost & Jungle enemies).
  - Shooting over **Frostpeak Ice Crystals** chills it into a **Frost Arrow** (`35%` `[PLACEHOLDER]` slow for `2.5s`).

---

### 5.3 Mechanic: Player Vitality (`3 Resolve Hearts`) & Shrine Meditation
- **Purpose**: Establish meaningful combat stakes across the 5 continents without punitive corpse-runs.
- **Parameters**:
  - **Base Vitality**: `3 Resolve Seals` (upgradeable to `5` `[PLACEHOLDER]` via Shrine Relics).
  - **Mercy Invulnerability (`i-frames`)**: `0.85s` `[PLACEHOLDER]` after taking damage, with white-ink blink feedback.
  - **Healing**: Resting (`[E]`) at any continent's **North Gate Shrine** or drinking **Focus Tea** restores Resolve.
- **Defeat State**:
  - Dropping to `0 Resolve` triggers a dramatic sumi-e ink-fade and revives the Samurai at the current continent's Plaza `(origin.x, origin.y)` with full Resolve and a modest `10%` `[PLACEHOLDER]` unbanked Gold drop (recoverable at the defeat spot!). Owned gear is **never** lost.

---

### 5.4 Mechanic: 5-Continent Regional Enemies, Hazards & Shrine Trials

Each continent introduces distinct enemy archetypes and environmental interplay so traveling North, South, East, or West changes *how* you fight:

| Continent | Enemy Archetypes (`v2.0`) | Signature Attack Pattern | Environmental Hazard / Boon | Shrine Guardian Trial Reward |
| :--- | :--- | :--- | :--- | :--- |
| **1. Kyoto** *(Center)* | **Straw Ronin**, **Dojo Spearman** | Telegraphed horizontal slash (`0.45s` tell) — ideal Parry tutorial | **Sacred Shrine Bell**: Ringing grants `10s` Ki regen aura | **Seal of the Crane**: Wider `Just-Deflect` window (`+0.05s`) |
| **2. Desert** *(West)* | **Dune Raider**, **Sand-Viper Archer** | Dash-back curved scimitar & twin-arrow volleys | **Sandstorm Gusts** push projectiles East; **Oasis Shore** cools stamina | **Seal of the Mirage**: Dash leaves a decoy ink clone for `1.5s` |
| **3. Frostpeak** *(North)* | **Glacier Pikeman**, **Yuki Frost-Bow** | Long-reach ice thrust + slowing frost arrows | **Slick Ice Patches** preserve slide momentum; **Lanterns** thaw chill | **Seal of Hoarfrost**: Combo Finisher (`Strike 4`) chills foes |
| **4. Jungle** *(South)* | **Bamboo Shinobi**, **Canopy Brute** | Smoke-vanish ambush from tree canopies + heavy club slam | **Monsoon Brush** conceals stealth; **Lotus Spores** burst when slashed | **Seal of Jade Wind**: Arrows ricochet once off trees/rocks |
| **5. Caldera** *(East)* | **Ash-Clad Oni**, **Ember Bladesman** | Heavy unblockable overhead smash (must **Dash**!) + fire wave | **Magma Vent Geysers** telegraph `1.2s` then erupt (`AOE` damage both sides!) | **Seal of Crimson Ash**: Charged Slash / Arrow ignites with ember burn |

---

### 5.6 Mechanic: Monster Loot Drops, Merchant Trade Counter & Gear Upgrade Tiers (Next Step)
- **Purpose**: Make far-away continents genuinely earned—players cannot simply sprint naked into Tier IV–V lands without hunting regional enemies, trading monster spoils for Gold, and forging stronger equipment.
- **Core Progression Loop**:
  1. **Defeat Regional Enemies** along expedition trails and continent borders.
  2. **Collect Trade Materials** into your Satchel:
     - *Tier I (Kyoto)*: **Worn Ronin Talisman** (`Trades for +20 Gold` `[PLACEHOLDER]`)
     - *Tier II (Desert)*: **Sun-Scorched Carapace** (`Trades for +35 Gold` `[PLACEHOLDER]`)
     - *Tier III (Jungle)*: **Jade Venom Fang** (`Trades for +55 Gold` `[PLACEHOLDER]`)
     - *Tier IV (Frostpeak)*: **Glacier Spirit Shard** (`Trades for +80 Gold` `[PLACEHOLDER]`)
     - *Tier V (Caldera)*: **Molten Obsidian Core** (`Trades for +120 Gold` `[PLACEHOLDER]`)
  3. **Trade at Master Kenji's Stall (`[Sell All Spoils]`)**: Convert gathered materials into Gold Coins with a bonus streak multiplier for rare drops.
  4. **Forge & Upgrade Equipment Tiers (`Lv. 1 → Lv. 5`)**:
     - **Katana Temper (`Lv. 1–5`)**: Scales slash damage so high-tier armored foes in Frostpeak & Caldera can be felled cleanly.
     - **Traveler's Armor / Resolve (`3 → 6 Hearts`)**: Prevents one-shot defeats against Tier IV–V guardians.
     - **Stride & Stamina (`Boots / Scarf Upgrades`)**: Sustains faster overland travel across the `3,500–9,000m` trails.

---

## 6. Economy Balance & Progression Model

### 6.1 Currency Sources (`Gold`)
| Source | Base Value | Respawn / Cadence | Notes |
| :--- | :-: | :-: | :--- |
| **Field Koban Coin** | `15 – 35 Gold` | `9.0s` respawn | `6` coins per continent (`30` live across the 5-continent world); highest value (`25–35G`) sits on each continent's Bridge |
| **Tameshigiri Bamboo Dummy** | `25 Gold` | `5.5s` rebuild | `4` targets per continent (`20` live across the world); triggered by any Katana OBB hit or Bow bullseye |
| **Regional Enemy Drop** *(v2.0)* | `15 – 40 Gold` `[PLACEHOLDER]` | Per defeat | Auto-pulled from `195 px` away when **Golden Magnet Bell** is equipped |
| **Continent Bounty Scroll** *(v2.0)* | `60 – 120 Gold` `[PLACEHOLDER]` | Per completion | Encourages walking the cardinal roads & mastering combos |

### 6.2 Currency Sinks (Master Kenji's Shop Inventory)
| Item | Category | Cost | Type | Mechanical Effect |
| :--- | :---: | :-: | :---: | :--- |
| **Golden Magnet Bell** | Charm | `35G` | Permanent Toggle | Expands coin pickup pull radius from `32 px` (`180 px/s`) → `195 px` (`340 px/s`) |
| **Crimson Wind Scarf** | Gear | `40G` | Permanent Toggle | `+18%` movement speed + dynamic crimson silk trail |
| **Gale Straw Hat** | Gear | `50G` | Permanent Toggle | Dash speed `680 → 820 px/s`, duration `0.16 → 0.20s`, cooldown `0.36 → 0.18s` |
| **Shadow Cloak** | Gear | `60G` | Permanent Toggle | Deep charcoal cloak dye + extended phantom dash afterimages |
| **Yumi War Bow** | Weapon | `65G` | Permanent Unlock | Grants `+10 Arrows` & unlocks `[Q]` **Weapon Switch** skill |
| **Moonlight Sword** | Weapon | `75G` | Permanent Toggle | Expands all 4 Katana OBB hitboxes (`+24–26 px` length, `+6–10 px` half-width) + double crescent arc |
| **Arrow Bundle ×10** | Ammo | `20G` | Repeatable Sink | Restocks `+10` steel-tipped bamboo arrows (`2 Gold / arrow`) |
| **Focus Tea Flask** | Elixir | `25G` | Repeatable Sink | `18.0s` **Focus Rush**: `+22%` speed, rapid `0.14s` bow / `0.05s` slash gate, `920 px/s` arrows |

> **Economy Solvency Check**:
> - **Starting Gold**: `120 Gold` (lets the player immediately choose two mid-tier gears OR **Yumi War Bow + Gale Hat** right on first session!).
> - **Total One-Time Permanent Unlocks**: `35 + 40 + 50 + 60 + 65 + 75 = 325 Gold` (`205 Gold` beyond starting purse—achievable in ~4–6 minutes of active exploration across 2–3 continents).
> - **Ongoing Sinks**: **Arrow Bundles (`20G`)** and **Focus Tea (`25G`)** prevent late-game Gold inflation once all permanent gear is owned.

---

## 7. System Interaction Matrix

| System A \ System B | Katana 4-Hit Combo | Yumi War Bow | Kaze Dash | Continent Terrain & Liquids | Shop Gear & Focus Tea |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Katana 4-Hit Combo** | Chains `0 → 1 → 2 → 3` within `1.25s` | Instant stance swap via `[Q]` mid-combo | Dash-cancel into `Strike 3` lunging thrust | Blocked by solid trunks/rocks; reaches over low shoreline edges | `Moonlight` widens OBBs; `Focus Tea` halves refire delay |
| **Yumi War Bow** | Soften distant targets before closing | *(v2.0)* Charged shot pierces 4 foes | Dash-kite backwards while loosing arrows | Arrows fly **over** ponds/magma, **stop** on trunks/pillars/stalls | *(v2.0)* Caldera braziers ignite arrows; Frost crystals chill |
| **Kaze Dash** | Closes gap for `Overhead Cleave` | Repositions for clear firing lanes | `Gale Hat` cuts CD `50%` | Sub-stepped (`8px`) so dashes slide cleanly along bridge rails | `Shadow Cloak` leaves phantom decoys |
| **Full World Map** | Disabled while modal open | Disabled while modal open | Resets velocity cleanly on arrival | `teleportTo()` nudges target out of liquids/trees automatically | Preserves all Gold, Arrows, Gear & active buffs across travel |

---

## 8. Phased Implementation Roadmap

- [x] **Phase A — Core Foundation (Completed)**:
  - 2.5D standing procedural Samurai rig (`Waraji` sandals, `Kyahan` shins, multi-finger hands, `120Hz` cloak), 4-move Kenjutsu Katana combo + OBB hitboxes, Yumi War Bow + `[Q]` Switch Skill, Master Kenji 1st-person Shop, and unified **5-Continent Open World** with walking roads + clickable **Full-View World Map**.
- [ ] **Phase B — Combat Depth (`Ki`, `Ink-Parry` & `Charged Bow`)**:
  - Add 3-pip Ki HUD indicator, `Right-Click / F` **Just-Deflect Ink-Parry** + `Iai Counter-Slash`, and `0.55s` **Charged Piercing Arrow** + elemental arrow ignition over Caldera/Frost props.
- [ ] **Phase C — Living 5-Continent Enemies & Resolve Vitality**:
  - Add `src/enemies.ts` with continent-specific AI archetypes (Straw Ronin, Dune Raider, Yuki Archer, Bamboo Shinobi, Ash Oni), `3 Resolve Seals` vitality, and North Gate Shrine meditation checkpoints.
- [ ] **Phase D — Five Elemental Ink Seals & Master Kenji Bounty Scrolls**:
  - Add 5 Continent Guardian Trials unlocking passive Ink Seals + rotating overland Bounty Scrolls (including no-teleport Courier Pilgrimages along the cardinal stone roads).
