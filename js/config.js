// Public configuration. Nothing in here is secret: an OAuth *client ID*
// is meant to be public; Google only accepts it from the origins you list
// in Google Cloud Console ("Authorized JavaScript origins").
//
// Paste your client ID below (see README.md, "Set up Google sign-in").
export const CONFIG = {
  googleClientId: '',
  // Lock the vault after this many minutes with no keyboard/mouse activity.
  autoLockMinutes: 15,
  // Largest single attachment, in megabytes.
  maxAttachmentMB: 20,
};
