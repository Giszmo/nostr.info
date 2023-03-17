---
title: expensive relay
permalink: /expensive relay/
web: 
github: fiatjaf/relayer/tree/master/expensive
tags:
- relay implementation
programming language: Go
license: 
nips:
---

> - a nostr relay implementation based on relayer.
> - uses postgres, which I think must be over version 12 since it uses generated columns.
> - requires users to manually register themselves to be able to publish events and pay a fee. this should prevent spam.
> - aside from that it's basically the same thing as relayer basic.