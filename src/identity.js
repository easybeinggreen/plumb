// Name + PIN sign-in. There is no login: a name is just a label, and the PIN is what stops someone else
// typing your name and landing in your stats. The PIN is checked in the database (public.plumb_* functions);
// the hash lives in a table the public key cannot read. Pure decision logic here, tested with node.
//
// What this does NOT do: it guards the name picker. The data itself is still reachable through the API with
// the public key that is in the page (see docs/database-schema.md), so this stops casual impersonation and
// accidental clashes, not a determined person poking the API.

export const PIN_LENGTH = 4;
export const isValidPin = (p) => /^[0-9]{4}$/.test(String(p == null ? '' : p));

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
export const setPin = (url, key, name, pin) => rpc(url, key, 'plumb_set_pin', { p_name: name, p_pin: pin });
export const verifyPin = (url, key, name, pin) => rpc(url, key, 'plumb_verify_pin', { p_name: name, p_pin: pin });

// What the picker should do next, from the database's answer about a typed name.
//   signin  : go straight in (the open demo name)
//   create  : ask for a new PIN (twice)
//   enter   : ask for the PIN
//   blocked : the name has data but no PIN and this device has never used it, so it cannot be claimed from here
//   invalid : nothing usable was typed
// `deviceKnowsName` is whether this browser has signed in as that name before.
export function nextStep(check, deviceKnowsName) {
  const status = check && check.status;
  const name = check && check.name;
  if (status === 'open') return { step: 'signin', name };
  if (status === 'new') {
    return { step: 'create', name, msg: `Welcome, ${name}. Choose a ${PIN_LENGTH}-digit PIN. It stops anyone else signing in as you.` };
  }
  if (status === 'unprotected') {
    return deviceKnowsName
      ? { step: 'create', name, msg: `${name} has no PIN yet. Choose a ${PIN_LENGTH}-digit PIN so nobody else can sign in as you.` }
      : { step: 'blocked', name, msg: `The name ${name} is already in use and has no PIN yet. Pick a different name, or open Plumb on the device you used before to set one.` };
  }
  if (status === 'protected') return { step: 'enter', name, msg: `Welcome back, ${name}. Enter your ${PIN_LENGTH}-digit PIN.` };
  return { step: 'invalid', msg: 'Please type a name (up to 40 characters).' };
}

// The words for a PIN check that did not succeed.
export function verifyMessage(res) {
  if (res && res.error === 'locked') return `Too many wrong tries. Try again in ${res.minutes || 15} minute${res.minutes === 1 ? '' : 's'}.`;
  if (res && res.error === 'wrong') return `That PIN isn't right. ${res.attemptsLeft} ${res.attemptsLeft === 1 ? 'try' : 'tries'} left.`;
  if (res && res.error === 'no_pin') return 'That name has no PIN yet. Go back and type the name again.';
  return 'Something went wrong. Please try again.';
}

// The words for a PIN that could not be set.
export function setPinMessage(res) {
  if (res && res.error === 'pin_format') return `The PIN must be exactly ${PIN_LENGTH} digits.`;
  if (res && res.error === 'already_protected') return 'That name already has a PIN. Go back and type the name again.';
  return 'Something went wrong. Please try again.';
}
