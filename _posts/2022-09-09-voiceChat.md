---
layout: post
title:  A Nostr Voice Chat Proof Of Concept
date:   2022-09-09
author: Leo Wandersleb
---

A while back I created a proof of concept for a Voice Chat over nostr.

* All audios are plain, not encrypted and public! Don't send what you would not
  want to be on public record forever!
* Although these events are meant to not get stored, there are data hoarders out
  there that hold on to all events ever so far.
* If it takes off, it will probably not be very censorship resistant as most
  relays don't allow event size as big as required for this.

But the cool thing about this project is anyway the simplicity with which those
nostr apps can be written and then just work for broadcasting to the world.

You can find the code
[here](https://github.com/Giszmo/NostrPostr/blob/master/NostrRelay/src/main/resources/public/chat.html)
and [here](https://github.com/Giszmo/Nostr-Voice-Chat).

You can try the app [here](https://relay.nostr.info/test/chat.html).
