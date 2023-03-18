---
title: Algia-Web
permalink: /algia-web/
web: 
github: ryogrid/algia-web
instances:
tags:
- client
platforms:
- Linux
- macOS
- Windows
license: MIT
progLang:
- Python 
authorNPub:  
---

> algia CLI command backed server-side rendering Nostr web client
> 
> - Handling of Nostr protcol is done by your machine running server program of algia-web
>   - algia is simple Nostr client which can run on CLI environmet
>   - At a point of view, algia-web is a kind of wrapper client of the client running on the machine (=algia)
> - This architecture can save communication amount and battery consumption of your smartphone and other mobile devices you use Nostr with Web browser at
> - Your web browser only renders contents received from the server
>   - **Almost all of clients for mobile devices handle messages received from relay server by myself. But the job consumes not small amount of computation and network resources**
>   - **Above job is ofen not acceptable for some people who use mobile devices out of doors does not offers rich UI/UX and support many features as Nostr client**
> - is developed in assumption that it is not used as main client and is used when you do not have power supply or connect to The internet via mobile network which has restriction of total communication amount
