This is the source behind [nostr.info](https://nostr.info).

If you have suggestions, please create pull requests.

If you see issues, please [report them](https://github.com/Giszmo/nostr.info/issues/new).

## Development

To run this project locally for development:

### Prerequisites
* Install [Ruby](https://www.ruby-lang.org/en/downloads/) (required for Jekyll)
* Install [Node.js](https://nodejs.org/en/learn/getting-started/how-to-install-nodejs)

### Setup Steps

1. **Install Ruby dependencies:**
   ```bash
   gem install bundler
   bundle install
   ```

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

3. **Build the React charts bundle:**
   ```bash
   npm run build:charts
   ```

4. **Start the development server:**
   ```bash
   bundle exec jekyll serve
   ```

The site will be available at `http://localhost:4000`

### Available npm scripts
* `npm run build:charts` - Build React charts bundle with Webpack (production mode)
* `npm run watch` - Watch for changes in source files during development
