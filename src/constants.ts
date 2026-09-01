/**
 * URL of the settings window page, served by Vite as an MPA entry.
 */
export const SETTINGS_WINDOW_URL = "/settings.html";

/**
 * Event emitted by the settings window after settings are saved,
 * carrying the full Settings object as payload.
 */
export const SETTINGS_UPDATED_EVENT = "settings-updated";

/**
 * Event emitted by the main window after it is dragged, carrying the new
 * WindowPosition as payload.
 */
export const POSITION_CHANGED_EVENT = "position-changed";
