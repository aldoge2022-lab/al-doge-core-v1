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
│       ├── orchestrator-v2.js
│       ├── create-checkout.js
│       └── stripe-webhook.js
├── tests/
│   └── orchestrator-v2.test.js
├── netlify.toml
└── package.json
```

Netlify è configurato per pubblicare `public/` e usare le functions da `netlify/functions`.
