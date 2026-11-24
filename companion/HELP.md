## Twinkly Lights

Controls **Twinkly Pro** controllers (PRO, MAX, PLUS, Lightwall) and **Twinkly** lights.

- Twinkly Pro: over OSC (documented at https://help.twinklypro.com/guides/osc/) or over the controller's local REST API (verified on PRO firmware 4.1.0; see the API references under Notes and limits).
- Twinkly: over the light's local REST API only (verified on firmware 2.11.0, a TWQ064STW Squares and a TWL100STW Line). Twinkly lights have no OSC.

The module detects the device type itself when the address is a device IP. You can also set it by hand with **Device type**.

### Twinkly lights

- Use **Control method: REST** with the light's IP. Each light needs its own connection.
- **Play effect** plays an effect uploaded to the light, chosen by name from the list, or by handle or UUID.
- **Start playlist** starts the light's playlist. Twinkly lights have only one, so the index is always 0.
- **Play built-in effect** plays one of the effects built into the light. The log says how many there are when the connection starts.
- Brightness, state reading, and the effect and playlist presets work the same as for Pro.

### Choosing a control method

|                              | OSC                                             | REST                                              |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| Address                      | a controller IP, or a broadcast address         | one controller's IP (for a group, the **master**) |
| Several controllers at once  | yes, with broadcast and wildcard targets        | no, one connection per controller or group        |
| Off, effects, playlists      | yes                                             | yes                                               |
| Brightness                   | ignored by the controller on PRO firmware 4.1.0 | yes                                               |
| Documentation                | Twinkly Pro OSC guide                           | Twinkly API references (see Notes and limits)     |
| Needs OSC enabled in the app | yes                                             | no                                                |

Whichever method you choose, the module can **read the real state** from the controller (see below) when the address is a controller IP.

### Before you start

1. For OSC: in the Twinkly Pro app, **Devices > your Object > Object Information > Device Information > Advanced Configuration > OTHER**, enable **OSC**, then save and confirm. OSC is off by default.
2. The controller must be configured, linked to your account, and have your effects installed.
3. Companion and the controller must be on the same LAN. Give controllers a static IP or a DHCP reservation.

### Configuration

- **Discovered device**: the Twinkly objects on your network: each group (listed under its master controller, with its members) and each standalone device. Group members aren't listed separately, because they may ignore commands sent to them directly. One is shown only if its group's master wasn't found. Choose an object and save, and the module fills in the IP, the device type and (for Pro) the OSC target. Twinkly lights are also switched to REST. Entries use the master controller's name, because the object's own name isn't available from the device. The connection remembers the device itself, not its IP, so it follows the device if DHCP gives it a new address. The list comes from a scan when the connection starts and every 5 minutes, or from the **Scan network** action. If the list is empty, close and reopen the connection's settings after a few seconds. Choose **Enter the address manually** to type the settings yourself.
- **Control method**: OSC or REST.
- **Address**: shown only when no discovered device is chosen. It lists only the addresses that work with the chosen control method, and you can also type one.
  - With **REST** it's **Device IP**: one entry per object (a group's master, or a standalone device).
  - With **OSC** it's **Controller IP or broadcast address**: Twinkly Pro objects, plus your network's broadcast address and `255.255.255.255` to reach every Twinkly Pro at once. Twinkly lights aren't offered, because they have no OSC.
- **OSC port** (OSC only): `9000`.
- **Read state from controller every (seconds)**: default 2, and 0 turns it off. Needs a controller IP.
- **Log every command sent**: writes each OSC message or REST command to the connection log.
- **Default target** (OSC only):
  - All controllers (`*`)
  - All PRO / MAX (`TwPRO*`)
  - All PLUS / Lightwall (`TwPLUS*`)
  - A specific controller: product type plus its MAC address (Device Information in the app), giving an ID like `TwPRO304950a030ec`.

With OSC, every action can override the default target. With REST, commands always go to the configured controller.

### Actions

- **Lights off**, **Play effect**, **Start playlist**
- **Set brightness** (absolute 0-100), **Adjust brightness** (relative -100..100), **Brightness filter on/off**
- **Send raw OSC** to `/v1/<device_id>/<path>`. This works in either mode.
- **Scan network for controllers**: see below.

**Play effect** can pick the effect by:

- **Name**, from a list read from the controller. This needs a controller IP. The list refreshes about once a minute.
- **Handle**: in the Twinkly Pro app, press and hold the effect on the device's **Controls** tab. The popup shows `ID:[#] [Name]` and the UUID. The ID is the handle, starting at 0 in list order.
- **UUID**, in upper or lower case.

**Start playlist** takes the playlist's index, with 0 as the first playlist. A handle, UUID or playlist index that doesn't exist is ignored, and the current content keeps playing.

**Brightness over OSC:** on PRO firmware 4.1.0 the controller ignored every OSC brightness message tested, including the OSC guide's own example. Brightness works with the REST control method.

### State: read back or assumed

When the address is a controller IP and state reading is on, the module asks the controller every few seconds what it is doing. It reads the mode, the effect (including the one a playlist is currently on), the playlist and the brightness. Variables and feedbacks then match the real lights, including changes made in the app. For a group, use the master's IP, because other group members don't report the group's state.

Without state reading, for example with a broadcast address, the module can only show what it **last sent**. OSC gets no replies. The `state_source` variable shows `controller` or `assumed`.

Variables: `mode`, `effect` (handle), `effect_name`, `playlist_name`, `brightness`, `brightness_filter`, `state_source`, `target`, `discovered_devices`.

### Controller IPs and groups

- Give controllers a static IP or a DHCP reservation, and don't change it after programming buttons (Twinkly's network guide makes the same recommendation).
- For Group Objects, send commands to the Group's **master** controller, which coordinates the others. Verified on PRO with OSC (`*` and the master's own device ID) and with REST, including brightness.
- OSC broadcast (`255.255.255.255` or the subnet broadcast address) with target `*` reaches every Pro controller on the subnet, not just one group. A specific device ID is still honoured over broadcast, and other controllers ignore it. On a computer with a VPN, `255.255.255.255` can sometimes fail to send. The subnet broadcast address is more reliable.
- Broadcast needs the network to allow it within the subnet. Guest Wi-Fi, client isolation, VLANs and firewalls can block it; UDP port 9000 must be open.

### Discovery

Twinkly doesn't document discovery, but Pro controllers answer the same UDP broadcast probe (port 5555) as Twinkly lights. The **Scan network for controllers** action broadcasts it on every network interface and writes the replies to the module log. For each Pro controller it also reads the controller's name as set in the app, its model, its group role (master, slave, or not in a group), and whether OSC and Art-Net are on. This step needs no login.

- Twinkly Pro controllers reply with a name like `TwPRO_a00f6c`. The suffix is the last 3 bytes of the controller's MAC address. The log shows a **suggested device ID** (e.g. `TwPRO304950a00f6c`). The `304950` prefix comes from Twinkly's OSC guide and was confirmed on three PRO controllers (TWPRO1500ETHP). Other models may differ, so check the suggestion against the MAC in the Twinkly Pro app before relying on it.
- Twinkly lights (`Twinkly_XXXXXX`) also reply. They have no OSC; use them with the REST control method.
- Scanning only finds controllers on subnets that Companion's machine has a network interface on, and only where broadcast is allowed.

The scan was verified on PRO controllers only. You don't need it to use the module: use the controller IP or a broadcast address with a wildcard target.

### Notes and limits

- The REST API is described in Twinkly's API reference (https://ledworks.atlassian.net/wiki/spaces/TWPUB/pages/1662222337/Twinkly+Runtime+API+Reference, for its cloud form) and in the community's xled-docs (https://xled-docs.readthedocs.io, for the local `/xled/` endpoints, which describe `/xled/v1/`). Twinkly Pro uses `/xled/v2/`, verified on TWPRO1500ETHP with firmware 4.1.0. A firmware update could change it; if REST stops working on Twinkly Pro, switch to OSC.
- REST logs in to the controller the same way the Twinkly API does. In testing, the Twinkly Pro app kept working alongside it.
- The integer after an OSC `playlist` command is the playlist index, with 0 as the first playlist (verified on PRO).
- "Disable brightness filter" sends `disabled A 100`, because the guide doesn't say which value to send.
- The OSC guide gives the effect handle range as both 0-15 and 0-n. Handles 16 and 17 worked on PRO, so it is 0-n.
- PLUS, Lightwall and MAX models have not been tested.
