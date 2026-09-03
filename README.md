# scripting

English | [简体中文](./README.zh-CN.md)

Scripts and utilities built with the [Scripting](https://apps.apple.com/app/id6471518264) app — a TypeScript-first scripting environment for iOS/iPadOS, supporting home screen widgets, Live Activities, Shortcuts and Safari userscripts.

## Contents

| Script | Description |
| ------ | ----------- |
| [surge-panel](./surge-panel/) | Surge HTTP API monitoring panel: multi-instance overview, policies, traffic, requests, engine settings, plus a live-speed home-screen widget. |
| [qweather](./qweather/) | QWeather dashboard page + home screen widget (current weather, hourly & 3-day forecast, AQI). Uses your personal QWeather API Host (2026 auth scheme). |
| [kimi-quota](./kimi-quota/) | Kimi Code (Coding Plan) usage tracker for multiple API keys — app page + home screen widget with per-account remaining %, progress bars and reset countdown. |
| [zcode-remote](./zcode-remote/) | ZCode remote connection launcher: full-screen in-app web page with browser-style controls, plus a home screen widget showing reachability status, latency and one-tap connect. |
| [reader](./reader/) | RSS reader: built-in RSS/Atom parsing (no DOM), a curated feed directory (137 feeds, CN/EN/JP), read/star states, full-text fetching, dark reading themes and gesture navigation, plus a home screen widget with the latest articles. |
| [submon](./submon/) | Subscription traffic monitor: add subscriptions in-app, view traffic usage/expiry details, convert subscription links via public subconverter backends, plus a traffic gauge home-screen widget. |

## Getting Started

1. Install the Scripting app from the App Store.
2. Clone or download this repository.
3. Copy the projects you want into the iCloud `Scripting/` folder.
4. Open a project in the app and run it.

## License

MIT © [LBurny](https://github.com/LBurny)