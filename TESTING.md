# Hardware test plan

Step-by-step checks to run against a real Twinkly Pro controller. Run them in order; later tests assume the earlier ones passed. Each test lists what you should see and what to write down.

## Test 0: Preparation

1. **Get the module into Companion.** In the repo, run:

   ```bash
   yarn install
   yarn build
   ```

   The project needs Yarn 4 (`packageManager` in package.json). If `yarn` reports a version mismatch, your global Yarn is v1 or your Corepack is too old. Run `npx -y corepack@latest yarn install` and `npx -y corepack@latest yarn build` instead, or update Corepack (`npm install -g corepack@latest && corepack enable`).

   Then, in the Companion launcher's advanced settings, point the developer-modules path at the folder _containing_ the repo folder and **enable developer modules**. Setting the path alone isn't enough. Or run `yarn package` and import the `twinkly-pro-0.1.0.tgz` it creates. Restart Companion if the module doesn't appear. If both an imported copy and the dev copy are installed, check that the connection uses the "(Dev)" version.

2. **Enable OSC on the controller.** In the Twinkly Pro app go to **Devices > your Object > Object Information > Device Information > Advanced Configuration**, scroll to **OTHER**, enable **OSC**, then save and confirm.
3. **Write down these values from the app:** the controller's **IP address**, **MAC address** and **model** (PRO, MAX, PLUS or Lightwall). Note the IDs of two or three installed effects: on the device's **Controls** tab, press and hold an effect. The popup shows `ID:[#] [Name]` (the ID is the handle) and the effect's UUID.
4. **Add the module in Companion.** Create a connection of type "Twinkly Pro" and set:
   - Controller IP: the controller's IP
   - Port: `9000`
   - Default target: `All Twinkly controllers (*)`
   - Tick **Log every OSC message sent**
5. **Check the status.** It should show OK (green). That only means the UDP socket opened. It doesn't prove the controller is reachable.
6. **Optional but useful: send a message without Companion,** to check the controller itself. On a Mac or Linux machine on the same network, install `oscsend` (the `liblo-utils` package) and run:
   ```bash
   oscsend CONTROLLER_IP 9000 "/v1/*/application/mode" s off
   ```
   If the lights go off, the controller and network are fine. If not, fix that before testing the module.

## Test 1: Basic commands with the wildcard target

1. Make a button and add the **Lights off** action. Press it.
2. Make a second button with **Play effect (movie mode)**, set to _Handle_ and your first effect's handle number. Press it.

Expected: the lights turn off, then the effect plays. The Companion log shows a line like `OSC -> 192.168.x.x:9000 /v1/*/application/mode ...`.

Write down: whether each worked, and how long the lights took to respond.

## Test 2: Specific controller ID

1. In the module config, set **Default target** to _Specific controller_. Choose the product type that matches your model (PRO/MAX or PLUS/Lightwall) and enter the MAC address. Any separator style works.
2. Press **Lights off**, then **Play effect** again.
3. Check the Companion log. The address should look like `/v1/TwPRO304950a030ec/application/mode`, with your own MAC.

If the lights respond, the ID format works. If they don't, switch the product type to the other option and retry, then write down which prefix your model needs.

## Test 3: Broadcast

1. Set the controller IP in the config to `255.255.255.255` and the target back to `All Twinkly controllers (*)`. Press **Lights off**, then **Play effect**.
2. Change the IP to your subnet's broadcast address. For example, if the controller is `192.168.0.104` on a standard `/24` network, use `192.168.0.255`. Repeat the two presses.

Write down: which of the two broadcast addresses worked. Some routers and switches block one of them, and that's useful to know.

When you finish, set the config back to the controller's IP.

## Test 4: Brightness

Make buttons for each of these and press them in order, watching the lights:

1. **Set brightness** to `50`, then `100`, then `10`.
2. **Adjust brightness (relative)** with `+20`, then `-20`.
3. **Brightness filter on/off** with _Enabled_ off, then on.

Write down:

- whether absolute and relative changes both work, and whether relative changes are visibly the size you expect
- what the lights do when the filter is switched off, because the module sends `disabled A 100` and that value is a guess
- whether the filter switching back on restores the previous level

## Test 5: Effect handles and UUIDs

1. **Play effect** by _Handle_, for each of the 2-3 handles you noted. Confirm each plays the effect the app lists under that handle.
2. If you have more than 16 effects, try handle `16` and above.
3. **Play effect** by _UUID_, pasting one of the UUIDs from the app.

Write down: whether handles above 15 work, and whether UUIDs behave the same as handles.

## Test 6: Playlist

1. Press **Start playlist** with index `0`.
2. Press it again with index `1`, then `2`, if you have more than one playlist.

Write down: whether the playlist starts, and whether the index value changes which playlist plays. The OSC guide never explains that number, so this is the main open question.

## Test 7: Scan

Verified on PRO hardware; repeat on any other model (PLUS, Lightwall, MAX) to see how it replies.

1. In Companion, press a button with **Scan network for controllers**. Wait about 5 seconds.
2. Read the module log. Each reply shows the IP, the type (Twinkly Pro, Twinkly, or unrecognised), the name and the raw hex. Pro controllers also get a suggested device ID.
3. Compare each suggested ID with the MAC shown in the Twinkly Pro app. The name suffix should equal the last 3 bytes of the MAC and the ID should be `TwPRO` followed by the full MAC.

Write down: any controller listed as unrecognised, any Pro controller without a suggested ID (for example PLUS or Lightwall models), and any suggested ID that doesn't match the app's MAC.

If nothing replies, capture the probe to see whether it leaves the machine:

```bash
sudo tcpdump -i any -n -X udp port 5555
```

On Windows, use Wireshark with the capture filter `udp port 5555`.

## Test 8: Check the state tracking

1. Press **Play effect** from Companion, then change the effect from the Twinkly Pro app.
2. Check the button's feedback and the `mode` and `effect` variables in Companion.

Expected: Companion still shows the effect it last sent, not the one you chose in the app. That's expected, because the controller sends no replies.

Write down: if it changes by itself, since that would mean the controller does report state.

## What to report

Trimmed to the relevant lines:

- your model, and which of Tests 1-6 passed or failed
- the Companion log lines from Test 7, including any unrecognised replies and their hex
- the answers to the four open questions: the `disabled` brightness value, the handle range, the playlist index, and which broadcast address worked
- the tcpdump output from Test 7 if the scan found nothing

## Results

### 2026-11-23: PRO (TWPRO1500ETHP), firmware 4.1.0

Setup: three PRO controllers on one `/22` subnet. Two of them form a group with a master. Commands went to the master (`192.168.7.187`) unless noted. They were sent from a script using the module's own OSC encoder, and the brightness example was also sent with `oscsend`.

| Test           | Result                                                                                                                                                                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: `*` target  | Pass. `off` and `movie <handle>` work.                                                                                                                                                                                                                                                                         |
| 2: specific ID | Pass. `TwPRO` + lowercase MAC works. The group master passes commands on to the other group member, with both `*` and its own ID.                                                                                                                                                                              |
| 3: broadcast   | Pass. `255.255.255.255` and the subnet broadcast both work. With `*`, broadcast reaches every Pro controller on the subnet, including ones outside the group.                                                                                                                                                  |
| 4: brightness  | **Fail.** No visible change and no change in the app, in any form: `enabled A 50`/`A 5`, `R -50`, float values, lowercase `a`, bare int/float, filter `disabled` then `enabled`, `*` and specific ID, master and non-master. Twinkly's own example sent with `oscsend` also failed. Open question for Twinkly. |
| 5: handles     | Pass. Handles start at 0 in the app's list order. 16 and 17 work, so the guide's "0-15" limit doesn't apply. Handles that don't exist (18, 40) are ignored and the current effect keeps playing.                                                                                                               |
| 5: UUID        | Pass. Upper and lower case both work.                                                                                                                                                                                                                                                                          |
| 6: playlist    | Pass. The index selects the playlist (0 = first, 1 = second). An index that doesn't exist (5) is ignored.                                                                                                                                                                                                      |
| 7: scan        | Pass. All 3 PRO controllers and 2 Twinkly lights replied. All suggested IDs matched the MACs in the app (`304950` prefix confirmed on 3 units).                                                                                                                                                                |
| 8: state       | No replies were received within 3 s of a command. As expected, the module only knows what it last sent.                                                                                                                                                                                                        |

Notes:

- On a Mac with a VPN, sending to `255.255.255.255` sometimes failed with `EHOSTUNREACH`, which used to abort the whole scan. The scan now logs the failure for that address and carries on with the others.
- Not tested: PLUS, Lightwall and MAX models.

#### Module buttons via Companion's HTTP API (same day)

Buttons were pressed with `POST /api/location/1/<row>/<col>/press`, and the sent OSC was read from the connection log. The connection host was `255.255.255.255`.

- Lights off (Tree Back's ID), Play effect 0 (`*`), Start playlist 0 (`*`) and Scan all worked as expected.
- **A specific ID filters even over broadcast.** Lights off addressed to `TwPRO304950a00f6c` turned off that controller's group, and Deck (a different ID) ignored it. With `*`, Deck switched effect too.
- Deck has no playlists and ignored `playlist 0`.
- All six brightness buttons sent the expected messages and the variables tracked them (50, +25, -25, filter off/on restoring 50, then 10), but the lights stayed at full brightness.

#### Local REST API (same day)

The controllers serve the Twinkly REST API on HTTP port 80 under `/xled/v2/`. Twinkly's own API reference covers its cloud form, and the local endpoints follow the community xled-docs. It is the Twinkly API (see [xled-docs](https://xled-docs.readthedocs.io), which describes `/xled/v1/`) with a new version prefix. `/xled/v1/...` returns 404 on PRO.

- **No login needed:** `GET gestalt` (name, model, group role and uid, `osc_en`, `artnet_en`, `max_movies` 32, `max_playlists` 4, network). `GET status`.
- **Login:** `POST login {"challenge": <base64 of 32 random bytes>}` returns `authentication_token`, `challenge-response` and `expires_in` 14400. Then `POST verify {"challenge-response": ...}` with header `X-Auth-Token`. The Twinkly Pro app kept working alongside it.
- **Read:** `application/mode` (mode, and for a playlist its name and current step), `summary`, `movies` (handle, name, UUID), `playlists`, `led/out/brightness`, `led/color`, `led/out/hue`, `osc`.
- **Write `application/mode`:** `{"mode":"off"}`, `{"mode":"movie","unique_id":...}` and `{"mode":"playlist","unique_id":...}` all work. Content can only be chosen by UUID: `id`, `movie_id`, `index` and `handle` were all ignored.
- **Write `led/out/brightness`:** `{"mode":"enabled","type":"A"|"R","value":n}` **works**. Values of 1, 10, 30 and 50 were visible on both trees, and the master passes the setting to the group (the slave reads back the same value). Relative changes stop at 0. `disabled` keeps the stored value. The Twinkly Pro app reflects changes sent over REST, brightness included. In the first test it still showed 100%, probably until its screen was refreshed.
- A group slave's `application/mode` doesn't show the group's playlist, so state has to be read from the master.

Module in REST mode (host `192.168.7.187`, state read every 2 s), pressed through the HTTP API:

| Button                                    | Result                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Lights off                                | Pass. The controller then reported `mode = off`.                                                               |
| Play effect 0 (by handle)                 | Pass. The handle was converted to its UUID, and the controller reported "Twist Vertigo".                       |
| Set brightness 10                         | Pass. The trees dimmed, and the controller reported 10.                                                        |
| Start playlist 0                          | Pass. Playlist "Xmas 1" started, and its current step "Candy Cane Strip" was shown.                            |
| Change made in the app (50 %, Xmas Rotor) | Pass. Companion showed `effect = 3`, "Xmas Rotor", brightness 50 within one poll. **Test 8 passes with REST.** |
| OSC mode after the refactor               | Pass. `movie 0` to broadcast, `state_source = assumed`.                                                        |

### 2026-11-23: Twinkly lights, firmware 2.11.0

Devices: Squares (TWQ064STW, firmware family T) and Line (TWL100STW, family S). Both serve only `/xled/v1/`, and `/xled/v2/gestalt` returns 404, which is how the module tells them apart from Pro. They use the same login as Pro. The status code is a top-level `code` rather than `result.code`.

| Command         | Request                                                                                      | Result                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Read mode       | `GET led/mode`                                                                               | Pass. Same fields as Pro's `application/mode`. Extra modes are `effect` (built-in) and `color`.              |
| Off             | `POST led/mode {"mode":"off"}`                                                               | Pass. Squares went dark.                                                                                     |
| Play effect     | `POST movies/current {"id": n}` or `{"unique_id": …}`, then `POST led/mode {"mode":"movie"}` | Pass. `movies/current` alone doesn't leave playlist mode. `led/mode {"mode":"movie","id":n}` ignores the id. |
| Playlist        | `POST led/mode {"mode":"playlist"}`                                                          | Pass. There is a single playlist (`GET playlist`).                                                           |
| Built-in effect | `POST led/effects/current {"effect_id": n}`, then `led/mode {"mode":"effect"}`               | Pass. Line has 5 built-in effects and Squares has 1.                                                         |
| Brightness      | `POST led/out/brightness`                                                                    | Pass. Line dimmed to 10%.                                                                                    |
| Module client   | `detectFamily` and every command above                                                       | Pass on Squares and Line, and on Tree Back for Pro.                                                          |

## Open items

As of 2026-11-23, after the hardware tests above.

### Waiting on Twinkly

- **OSC brightness on PRO firmware 4.1.0** (Test 4). Ignored in every form tested, including the OSC guide's own `oscsend` example, while REST brightness works. A report for Twinkly support is drafted (kept outside the repo). Re-run Test 4 after any firmware update.
- **Value to send with `disabled`** in `led/brightness`. The OSC guide doesn't say. The module sends `disabled A 100`. Of the four open questions in "What to report", this is the only one left: the handle range, the playlist index and broadcast are answered.

### Not yet tested on hardware

- **PLUS, Lightwall and MAX models** (any method). To check on each:
  - the OSC device ID prefix (`TwPLUS` for PLUS and Lightwall is assumed from the guide)
  - whether the MAC starts with `304950` (only confirmed on PRO)
  - the name in the discovery reply, and whether a suggested ID can be built from it
  - whether `/xled/v2/` REST works, and what gestalt reports
- **Other Twinkly (non-Pro) models and firmware.** Only firmware 2.11.0 (families T and S) has been tested. Older lights may differ.
- **Pro firmware other than 4.1.0.** Nothing in Twinkly's OSC guide covers the `/xled/v2/` REST API, so check REST after any firmware update.
- **Token expiry.** A REST login lasts 4 hours. Logging in again after a 401 is covered by unit tests but hasn't been seen on a device. A connection left running for more than 4 hours would show it.
- **A group whose master is offline.** Discovery should list the slave with a warning. Covered by unit tests only.
- **Following a device after DHCP gives it a new IP.** Covered by unit tests only.
- **Discovery across subnets or VLANs.** Only one /22 network has been tested. The scan only reaches networks this computer is on.

### Known limitations

- **No state from slaves.** A group slave doesn't report the group's playlist, so state must be read from the master.
- **Built-in effects aren't read back.** When a Twinkly light is in `effect` mode, the module doesn't read which built-in effect is playing (`led/effects/current` isn't polled).
- **The Effect matches feedback accepts a handle, UUID or name.** An effect named like a number (e.g. "3") can collide with handle 3.
- **Art-Net isn't implemented.** The controllers report `artnet_en`, and Art-Net channel 1 is brightness. It could be a third control method, but needs a fixed controller IP and Art-Net enabled in the app.
