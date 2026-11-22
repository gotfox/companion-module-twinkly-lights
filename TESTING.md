# Hardware test plan

Step-by-step checks to run against a real Twinkly Pro controller. Run them in order; later tests assume the earlier ones passed. Each test lists what you should see and what to write down.

## Test 0: Preparation

1. **Get the module into Companion.** In the repo, run:
   ```bash
   yarn install
   yarn build
   ```
   Then point Companion's developer-modules path at the repo folder (Companion Settings, Advanced), or run `yarn package` and import the `twinkly-pro-0.1.0.tgz` it creates. Restart Companion if the module doesn't appear.
2. **Enable OSC on the controller.** In the Twinkly Pro app go to **Devices > your Object > Object Information > Device Information > Advanced Configuration**, scroll to **OTHER**, enable **OSC**, then save and confirm.
3. **Write down these values from the app:** the controller's **IP address**, **MAC address** and **model** (PRO, MAX, PLUS or Lightwall). Note the IDs of two or three installed effects, using the handle numbers and UUIDs from the Controls panel.
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

## Test 7: Experimental scan

1. Start a packet capture on the machine running Companion, so you can see the probe leave:
   ```bash
   sudo tcpdump -i any -n -X udp port 5555
   ```
   On Windows, use Wireshark with the capture filter `udp port 5555` instead.
2. In Companion, press a button with **Scan network for controllers (experimental)**. Wait 5 seconds.
3. Read the Companion module log. Look for lines starting `Reply from ...` and `device info`.
4. Stop the capture and save the output.

The outcomes mean different things:

- **Replies with `name=...`:** the controller answers the probe. Paste the log lines, including the hex.
- **Replies without a name:** the controller answers, but in a different format. The hex will show the format.
- **No replies, but tcpdump shows the probe going out:** Pro controllers likely don't use this protocol.
- **No replies and nothing in tcpdump:** the probe never left the computer. Check that Companion's machine is on the same network, and note which OS and network interfaces it has.

If the log also shows `device info: name=... mac=...`, the HTTP lookup works too. If it says no HTTP device info, that lookup doesn't apply to your controller.

## Test 8: Check the state tracking

1. Press **Play effect** from Companion, then change the effect from the Twinkly Pro app.
2. Check the button's feedback and the `mode` and `effect` variables in Companion.

Expected: Companion still shows the effect it last sent, not the one you chose in the app. That's expected, because the controller sends no replies.

Write down: if it changes by itself, since that would mean the controller does report state.

## What to report

Trimmed to the relevant lines:

- your model, and which of Tests 1-6 passed or failed
- the Companion log lines from Test 7, plus any hex
- the answers to the four open questions: the `disabled` brightness value, the handle range, the playlist index, and which broadcast address worked
- the tcpdump output from Test 7 if the scan found nothing
