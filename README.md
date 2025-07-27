# Commander

A Raycast extension that lets you run and manage your favorite CLI commands in a fast and keyboard-first way with LRU (Least Recently Used) history.

## Features

- **Command Execution**: Execute any CLI command directly from Raycast
- **LRU History**: Commands are automatically stored and sorted by least recently used
- **Search & Filter**: Quickly find commands in your history
- **Keyboard Shortcuts**: Full keyboard navigation and shortcuts
- **Command Management**: Delete individual commands or clear entire history
- **Configurable**: Customize shell and history size preferences

## Usage

1. **Launch Commander** from Raycast
2. **Type a command** in the search bar (e.g., `brew update`, `ls -la`, `git status`)
3. **Press Cmd+Enter** to execute the command
4. **Browse history** - previously executed commands appear below
5. **Select from history** - click or use arrow keys to select and execute

## Keyboard Shortcuts

- `Cmd+Enter` - Execute the typed command or selected history item
- `Cmd+C` - Copy selected command to clipboard
- `Cmd+Delete` - Delete selected command from history
- `Cmd+Shift+Delete` - Clear entire command history

## Preferences

You can customize the extension behavior in Raycast preferences:

- **Maximum History Size**: Set how many commands to keep in history (default: 50)
- **Default Shell**: Specify which shell to use for command execution (default: /bin/zsh)
- **Shell Profile**: Specify a shell profile to source (e.g., `~/.zshrc`, `~/.bash_profile`) to ensure your PATH and environment variables are loaded

## Troubleshooting

### "Command not found" errors
If you get "command not found" errors (like with `node`, `npm`, `brew`, etc.), try:
1. Set the **Shell Profile** preference to your shell configuration file (e.g., `~/.zshrc`)
2. Make sure the command is installed and available in your shell
3. Check that your PATH environment variable includes the necessary directories

### Permission errors
Some commands may require elevated permissions. The extension runs commands with your user permissions.

## How LRU Works

Commands are automatically sorted by "Least Recently Used" order:
- New commands are added to the end of the list
- When you execute an existing command, it moves to the end (most recently used)
- Commands that haven't been used in a while appear at the top
- This helps you quickly access commands you haven't used recently

## Examples

Common commands you might use:
- `brew update` - Update Homebrew packages
- `git status` - Check git repository status
- `ls -la` - List all files with details
- `npm install` - Install npm packages
- `docker ps` - List running Docker containers
- `ssh user@server` - Connect to remote server

## Development

This extension is built with:
- React
- TypeScript
- Raycast API
- Node.js child_process for command execution

## License

MIT