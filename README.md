# dserve

[![CircleCI](https://circleci.com/gh/Automattic/dserve/tree/master.svg?style=svg)](https://circleci.com/gh/Automattic/dserve/tree/master)

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
127.0.0.1 calypso.localhost
```

Then you may either specify a branch or a hash to load.

1. branch: calypso.localhost:3000?branch={branchName}
2. hash: calypso.localhost:3000?hash={commitHash}


## Logs

DServe uses `node-bunyan` for structured logging. Most logs are both written to the console and written to the file ./logs/log.txt.
The build log for each individual image is written to the build-dir and is retained in the case of a failed build.


