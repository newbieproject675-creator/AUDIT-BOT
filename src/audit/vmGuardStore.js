// vmGuardStore.js
//
// The VM guard keeps its data in its OWN file (data/<serverId>.vmguard.json)
// instead of the main settings file. Other background jobs save the whole
// settings file when they finish; if the VM guard lived there, one of them
// could overwrite a button click made while it was running - and the list of
// roles that were removed (needed to restore them) would be lost.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");

function defaultState() {
  return {
    enabled: false,
    thresholdDays: 7, // more than this many VM days triggers a review
    gapDays: 3, // VMs that start less than this many days after the last one ended count together
    iaRoleId: null, // the Internal Affairs role that approves removals
    iaChannelId: null, // where review requests are posted
    protectedRoleIds: [], // roles that are never removed
    lastRunAt: null,
    tracking: {}, // nationId -> VM history, used to spot back-to-back VMs
    requests: {}, // requestId -> a review message (pending or decided)
    stripped: {} // nationId -> roles that were removed, waiting to be restored
  };
}

function fileFor(guildId) {
  return path.join(DATA_DIR, `${guildId}.vmguard.json`);
}

// A missing file just means "not set up yet". A file that exists but can't be
// read is NOT treated as empty - that would wipe the saved data on the next
// save - so it throws instead.
function loadVmGuard(guildId) {
  const file = fileFor(guildId);
  const defaults = defaultState();
  if (!fs.existsSync(file)) return defaults;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    ...defaults,
    ...saved,
    protectedRoleIds: saved.protectedRoleIds || [],
    tracking: saved.tracking || {},
    requests: saved.requests || {},
    stripped: saved.stripped || {}
  };
}

function saveVmGuard(guildId, state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = fileFor(guildId);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, file); // replace in one step so a crash can't leave half a file
}

// Read, change and save in one go with nothing awaited in between, so two
// changes can't overwrite each other.
function updateVmGuard(guildId, mutate) {
  const state = loadVmGuard(guildId);
  const result = mutate(state);
  saveVmGuard(guildId, state);
  return result;
}

module.exports = { loadVmGuard, saveVmGuard, updateVmGuard, defaultState };
