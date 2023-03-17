---
title: sovereign-stack
permalink: /sovereign-stack/
web: https://git.sovereign-stack.org/ss/sovereign-stack
github: 
tags:
- relayImplementation
programming language: 
license: 
---

> Each domain that gets deployed can optionally have a Nostr relay deployed. It is expected that multiple relay processes will get deployed to address various use cases, e.g., [free] application logging, [expensive] public relay. But at the moment, IF you specify a nostr pubkey, Sovereign Stack instance will make that pubkey NIP-05 compliant and deploy a nostr relay at wss://relay.domain.tld whitelisted for that pubkey. In addition, in accordance with NIP-05, nostr clients are directed to the deployed nostr relay at wss://relay.domain.tld.
>
> Sovereign Stack websites can make an nostr pubkey NIP-05 compliant. All this means is you have some service endpoint under a domain name that is attesting to your pubkey. It's useful for search functionsl on nostr, e.g., a client can search for 'sovereign-stack.org' and be directed to a specific nostr pubkey.