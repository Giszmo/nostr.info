---
permalink: /
layout: home
---

## What is nostr?

"nostr" stands for "**N**otes and **O**ther **S**tuff **T**ransmitted by
**R**elays" and is an open protocol for censorship-resistant global networks
created by [@fiatjaf](https://github.com/fiatjaf).

You can find a very decent overview of tools and projects at
[aljazceru/awesome-nostr](https://github.com/aljazceru/awesome-nostr)!

## What is nostr.info?

Nostr.info aims to be the
"blockchain.info" of nostr - not necessarily the blockchain.com it turned into.

Blockchain.info started out as a collection of interesting charts and
interactive tools to explore the Bitcoin blockchain and core performance
parameters and nostr.info was registered to provide something similar for the
nostr ecosystem.

The current state might be more a playground but features to come are:

- Show all events and help the user interpret them. Check out
  [Relays](/relays/). It already gives some idea of recent events. If you want
  to dig into one specific event, try out [nostr.com](https://nostr.com)
- Show all relays and their features and performance - a bit like
  [nostr-registry](https://nostr-registry.netlify.app/). [Relays](/relays/)
  already does this a bit but expect a lot more to come!
- Provide a nostr client under this domain
- Charts
  - Events per hour/day/week
  - Split by kind/size
  - Active pubkeys per hour/day/week
  - Follows graphs - and how they change over time

## Nostr Overview

### Clients

<table>
{%- for p in site.pages -%}
  {%- if p.tags contains "client" -%}
    {%- if p.github -%}
      {%- assign url = p.github | prepend: "https://github.com/" -%}
    {%- else -%}
      {%- assign url = p.web -%}
    {%- endif -%}
    <tr>
      <td><strong><a href="{{ url }}">{{ p.title }}</a></strong><br>
      <ul>{%- for i in p.instances -%}
              <li><a href="{{ i.url | default: i }}">{{ i.name | default: i }}</a>{%- if i.comment -%}: {{ i.comment }}{%- endif -%}</li>
              {%- endfor -%}</ul></td>
      <td>{%- if p.github -%}<img src="https://img.shields.io/github/stars/{{ p.github }}.svg?style=social" alt="stars">{%- endif -%}</td>
      <td>{%- if p.content.size > 20 -%}<a href="{{ p.permalink }}">🔍</a>{%- endif -%}</td>
    </tr>
  {%- endif -%}
{%- endfor -%}
</table>
