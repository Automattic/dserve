# dserve

A development server for serving branches of your docker-based web application an on-demand basis.

It can build images for any hash, run containers, stop a containers that haven't been accessed in a
while, proxy requests to the right container based on query params, etc.

## Install

```bash
git clone git@github.com:Automattic/dserve.git
cd dserve
yarn
yarn start
```

## Use

You will need to modify your hosts file to include the following line:

```
localhost wpcalypso.wordpress.com
```

Then you may either specify a branch or a hash to load.

1. branch: wpcalypso.wordpress.com?branch={branchName}
2. hash: wpcalypso.wordpress.com?hash={commitHash}
