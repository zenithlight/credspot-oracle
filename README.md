# credspot-oracle

This creates a webhook endpoint that is intended to be triggered by a GitHub webhook on the repository that is being tracked. When the webhook fires, this script will recalculate the Cred scores for GitHub contributors in the repo, 

1. Copy `.env.template` to `.env` and fill in the values with the deployed OpenOracleFramework contract address and the private key of the authorized feed signer.
2. In the parent directory, `git clone https://github.com/zenithlight/sourcecred`
3. `(cd sourcecred/packages/sourcecred; yarn build)`
4.
```
yarn add file:../sourcecred/packages/sourcecred/
npm install
echo "{}" > cached-identities.json
node index.js
```

5. If you want to point the oracle to a different repo than `zenithlight/credspot-demo` 