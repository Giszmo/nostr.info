This is the source behind [nostr.info](https://nostr.info).

If you have suggestions, please create pull requests.

If you see issues, please [report them](https://github.com/Giszmo/nostr.info/issues/new).

## Features

* **[/events/](https://nostr.info/events/)** — Live event explorer. Connects to
  relays, streams events, and lets you filter by kind (90+ mapped), pubkey, and
  follow-degree. Deep-linkable via URL params.
* **[/resources/](https://nostr.info/resources/)** — Curated catalog of Nostr
  tools, clients, libraries, and relays (loaded live from nostr as kind-30078
  events).
* **[/njump/](https://nostr.info/njump/)** — Nostr-to-web gateway
  ([njump](https://github.com/fiatjaf/njump)) for browsing profiles, notes, and
  relays via HTTP with OpenGraph previews.
* **NIP-66 relay monitor** — Publishes relay availability data as kind-30166
  events using [@nostrwatch/relaymon](https://github.com/sandwichfarm/nostr-watch).

## Development

Requirements: [Ruby](https://www.ruby-lang.org/) (3.x),
[Bundler](https://bundler.io/), [Node.js](https://nodejs.org/) (for the
resource submodule data).

```bash
git clone https://github.com/Giszmo/nostr.info.git
cd nostr.info
bundle install
bundle exec jekyll serve
```

The site is then available at `http://localhost:4000`.

### Deployment

```bash
bundle exec jekyll build          # output in _site/
rsync -av --delete _site/ /var/www/nostr.info/
```

### NIP-05

The NIP-05 identity file is generated from `_pages/nostr.html` →
`/.well-known/nostr.json`.

## License

[MIT](LICENSE)
