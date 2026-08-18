const { Entry } = require("@napi-rs/keyring");

const SERVICE = "bull-board-cli";

// A profile can legitimately have no password. The keyring stores this sentinel
// so an explicitly empty password is distinguishable from "never set" and mapped
// back to null on read.
const EMPTY_PASSWORD = "__NO_PASSWORD__";

function entryFor(profile) {
  return new Entry(SERVICE, profile);
}

async function savePassword(profile, password) {
  entryFor(profile).setPassword(password || EMPTY_PASSWORD);
}

async function getPassword(profile) {
  // Entry.getPassword() returns null when no entry exists.
  const password = entryFor(profile).getPassword();

  if (!password || password === EMPTY_PASSWORD) {
    return null;
  }

  return password;
}

async function deletePassword(profile) {
  // Returns false when there was nothing to delete; callers don't care.
  return entryFor(profile).deletePassword();
}

module.exports = {
  savePassword,
  getPassword,
  deletePassword,
};
