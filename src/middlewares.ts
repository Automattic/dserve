// external
import * as expressSession from "express-session";

// internal
import {
  getCommitHashForBranch,
  CommitHash,
  touchCommit
} from "./api";

const hashPattern = /(?:^|.*?\.)hash-([a-f0-9]+)\./;

function assembleSubdomainUrlForHash(req: any, commitHash: CommitHash) {
  const protocol = req.secure || req.headers.host.indexOf( 'calypso.live' ) > -1 ? "https" : "http";

  return (
    protocol +
    "://hash-" +
    commitHash +
    "." +
    stripCommitHashSubdomainFromHost(req.headers.host)
  );
}

function stripCommitHashSubdomainFromHost(host: string) {
  return host.replace( hashPattern, '' );
}

function getCommitHashFromSubdomain(host: string) {
  const match = host.match( hashPattern );

  if ( ! match ) {
    return null;
  }

  const [ /* full match */, hash ] = match;
  return hash;
}

export function redirectHashFromQueryStringToSubdomain(
  req: any,
  res: any,
  next: any
) {
  const isHashSpecified = req.query && (req.query.hash || req.query.branch);

  if (!isHashSpecified) {
    next();
    return;
  }

  const commitHash = req.query.hash || getCommitHashForBranch(req.query.branch);

  res.redirect(assembleSubdomainUrlForHash(req, commitHash));

  res.end();
}

export function determineCommitHash(req: any, res: any, next: any) {
  const isHashInSession = !!req.session.commitHash;
  const subdomainCommitHash = getCommitHashFromSubdomain(req.headers.host);

  if (isHashInSession && !subdomainCommitHash) {
    next();
    return;
  }

  if (!subdomainCommitHash) {
    // @todo Render a nicer page here.
    res.send("Please specify a branch to load");
    return;
  }

  req.session.commitHash = subdomainCommitHash;

  touchCommit(subdomainCommitHash);

  next();
}

export const session = expressSession({
  secret: "keyboard cat",
  cookie: {},
  resave: false,
  saveUninitialized: true
});
