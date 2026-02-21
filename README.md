# AL DOGE Core v1

Struttura attuale del progetto:

```
al-doge-core-v1
├── public/
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── data/
│       └── catalog.js
├── netlify/
│   └── functions/
│       ├── create-checkout.js
│       ├── openai-suggestion.js
│       ├── ordine-ai.js
│       └── stripe-webhook.js
├── tests/
│   └── ordine-ai.test.js
├── netlify.toml
└── package.json
```

Netlify è configurato per pubblicare `public/` e usare le functions da `netlify/functions`.
