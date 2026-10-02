// Name picker. There is no login, no PIN, no password: a name is just a label typed into the app.
// Once a name has data, nobody else can type their way into it -- they just get asked for a
// different name. A name this device has used before always gets back in, no server round trip
// needed for permission, since it is (as far as Plumb can tell) the same person's own device.
//
// What this does NOT do: stop a determined person from typing someone else's name on a device
// that has never used it (they'd just be told it's taken and have to pick another -- there is no
// way to prove it's "theirs" from a new device). The data itself is still reachable through the
// API with the public key that is in the page (see docs/database-schema.md). This is a courtesy
// against casual mix-ups, not a security boundary.

async function rpc(url, key, fn, body) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${fn} failed (${res.status})`);
  return res.json();
}
export const checkName = (url, key, name) => rpc(url, key, 'plumb_check_name', { p_name: name });

// What the picker should do next, from the database's answer about a typed name.
//   signin : free to use, or this device has signed in as it before -- go straight in
//   taken  : someone else already has this name -- ask for a different one
//   invalid: nothing usable was typed
// `deviceKnowsName` is whether this browser has signed in as that name before.
export function nextStep(check, deviceKnowsName) {
  const name = check && check.name;
  if (!name) return { step: 'invalid', msg: 'Please type a name (up to 40 characters).' };
  if (deviceKnowsName || check.status === 'new' || check.status === 'open') return { step: 'signin', name };
  return { step: 'taken', name, msg: `${name} is taken. Try another name.` };
}
