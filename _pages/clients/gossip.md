---
title: Gossip
permalink: /gossip/
web: 
github: mikedilger/gossip
instances:
tags:
- social
- client
platforms:
- Linux
- Windows
license: MIT
progLang: 
- Rust
authorNPub: npub1acg6thl5psv62405rljzkj8spesceyfz2c32udakc2ak0dmvfeyse9p35c
---

> Gossip follows people at they relays they profess to post to. That means it has to discover which relays those are (see https://github.com/nostr-protocol/nips/blob/master/65.md) and make smart relay selection choices based on things like which relays cover the most people you follow.
>
> Gossip handles private keys as securely as reasonable (short of hardware tokens), keeping them encrypted under a passphrase on disk, requiring that passphrase on startup, and zeroing memory.
>
> Gossip avoids web technologies (other than HTTP GET and WebSockets). Web technologies like HTML parsing and rendering, CSS, JavaScript and the very many web standards, are complex and represent a security hazard due to such a large attack surface. This isn't just a pedantic or theoretical concern; people have already had their private key stolen from other nostr clients. We use simple OpenGL-style rendering instead. It's not as pretty but it gets the job done.


