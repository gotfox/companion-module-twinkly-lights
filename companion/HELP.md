## Twinkly Pro (OSC)

Controls Twinkly Pro controllers using the OSC interface documented at https://help.twinklypro.com/guides/osc/.

### Before you start

1. In the Twinkly Pro app: **Devices > your Object > Object Information > Device Information > Advanced Configuration > OTHER**, enable **OSC**, save and confirm. OSC is off by default.
2. The controller must be configured, linked to your account, and have your effects installed.
3. Companion and the controller must be on the same LAN. Avoid changing controller IPs after programming buttons.

### Configuration

- **Controller IP or broadcast address**: a controller's IP, or a subnet broadcast address (e.g. `192.168.0.255`) to reach many controllers without knowing their IPs. Default `255.255.255.255`.
- **OSC port**: `9000`.
- **Default target**:
  - All controllers (`*`)
  - All PRO / MAX (`TwPRO*`)
  - All PLUS / Lightwall (`TwPLUS*`)
  - A specific controller: product type plus its MAC address (Device Information in the app), giving an ID like `TwPRO304950a030ec`.

Every action can override the default target.

### Actions

- **Lights off**, **Play effect** (by handle 0-15+ or UUID), **Start playlist**
- **Set brightness** (absolute 0-100), **Adjust brightness** (relative -100..100), **Brightness filter on/off**
- **Send raw OSC** to `/v1/<device_id>/<path>`
- **Scan network (experimental)**: see below

Effect handles and UUIDs are listed in the app's Controls panel for the Object.

### No feedback from controllers

Twinkly Pro documents no OSC replies. Connection status only means Companion can transmit UDP. The module's variables (`mode`, `effect`, `brightness`, `brightness_filter`) and feedbacks show what Companion _last sent_, not the real state. Changes made in the app or by other systems are not seen.

### Controller IPs and groups

- Give controllers a static IP or a DHCP reservation, and don't change it after programming buttons (Twinkly's network guide makes the same recommendation).
- For Group Objects, send OSC to the Group's **master** controller, which coordinates the others.
- Broadcast needs the network to allow it within the subnet. Guest Wi-Fi, client isolation, VLANs and firewalls can block it; UDP port 9000 must be open.

### Discovery

Twinkly doesn't document discovery, but Pro controllers answer the same UDP broadcast probe (port 5555) as consumer Twinkly lights. The **Scan network for controllers** action broadcasts it on every network interface and writes the replies to the module log:

- Twinkly Pro controllers reply with a name like `TwPRO_a00f6c`. The suffix is the last 3 bytes of the controller's MAC address. The log shows a **suggested device ID** (e.g. `TwPRO304950a00f6c`). The `304950` prefix is assumed from Twinkly's OSC guide and was confirmed on one PRO controller, so check the suggestion against the MAC in the Twinkly Pro app before relying on it.
- Consumer Twinkly lights (`Twinkly_XXXXXX`) also reply. They are not OSC targets and are only listed for information.
- Scanning only finds controllers on subnets that Companion's machine has a network interface on, and only where broadcast is allowed.

The scan was verified on PRO controllers only. You don't need it to use the module: use the controller IP or a broadcast address with a wildcard target.

### Notes on ambiguous parts of the guide

- The guide's playlist example sends an integer after `playlist`; its meaning is undocumented, so it is exposed as an option (default 0).
- "Disable brightness filter" sends `disabled A 100`; the guide doesn't specify the value for that case.
- Effect handle range is given as both 0-15 and 0-n.
