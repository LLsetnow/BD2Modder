import { SettingsPage } from './settings-page.js';
import { DEFAULT_SHORTCUTS, validateShortcuts, actionForEvent } from '../app/keybindings.cjs';
import { PartContextMenu, grayHiddenRegions } from './part-visibility.js';
window.BDSettings = Object.freeze({ SettingsPage, DEFAULT_SHORTCUTS, validateShortcuts, actionForEvent, PartContextMenu, grayHiddenRegions });
