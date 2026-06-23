# English Listening Looper

Chrome/Edge Manifest V3 extension for repeating sentence-level clips on web pages that use an HTML5 `<video>` element.

## Features

- Add the current playback time as a sentence node.
- Delete any node from the node list.
- Replay the active node.
- Move to the previous or next node.
- Show nodes on a custom progress bar.
- Toggle whether a newly added node keeps the previous node.
- Set an optional end point for the active node and loop it.
- Customize shortcuts from the extension overlay.
- Collapse or expand the shortcut settings panel.
- Resize the overlay before hiding it.
- Save nodes per page URL with `chrome.storage.local`.
- Hide the overlay as a small restore button when it is not needed.

## Default Shortcuts

```text
F8             Add node, or replace the current/last node when "Keep previous node" is off
F9             Replay active node
F10            Set active node end point
Alt + Left     Previous node
Alt + Right    Next node
Ctrl+Shift+L   Hide or show the overlay
```

To change a shortcut, open the overlay, expand `Shortcuts` if needed, click the shortcut button for an action, then press the new key combination. Press `Escape` to cancel. Some browser or operating system shortcuts may not be available to webpage scripts.

The overlay can be resized before it is hidden. The size and shortcut panel collapsed state are saved locally.

## Install Locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this repository folder.

## Privacy

This extension does not send data to any remote server. It stores sentence nodes, shortcut preferences, and UI preferences locally in `chrome.storage.local`. Page data is keyed by a hashed page identifier; the raw page URL and title are not stored.

## Notes

This works best on ordinary HTML5 video pages. DRM-heavy streaming services may block or replace the video element in ways that reduce reliability.




