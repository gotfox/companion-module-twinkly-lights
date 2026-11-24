# companion-module-twinkly-lights

Bitfocus Companion module for [Twinkly Pro](https://twinklypro.com) controllers (PRO, MAX, PLUS, Lightwall) and [Twinkly](https://twinkly.com) lights, using OSC (Pro) or the local REST API (both).

See [HELP.md](./companion/HELP.md) and [LICENSE](./LICENSE).

## Development

```bash
yarn            # install
yarn build      # compile to dist/
yarn dev        # watch mode
yarn test       # build + unit tests (OSC encoding and addressing)
yarn lint
yarn package    # build a distributable .tgz
```

Protocol reference: <https://help.twinklypro.com/guides/osc/>

Testing against real hardware: see [TESTING.md](./TESTING.md).
