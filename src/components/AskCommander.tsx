import React, { useState, useEffect } from "react";
import {
  ActionPanel,
  Action,
  List,
  showToast,
  Toast,
  getPreferenceValues,
  Icon,
  Color,
  Detail,
} from "@raycast/api";
import { useAI } from "@raycast/utils";
import { exec } from "child_process";
import { promisify } from "util";
import { LocalStorage } from "@raycast/api";
import { CommandHistory, Preferences } from "../types";
import { getCurrentFinderPath } from "../utils/finder";

const execAsync = promisify(exec);

export default function AskCommander() {
  const [searchText, setSearchText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [selectedCommand, setSelectedCommand] = useState<CommandHistory | null>(null);
  const [preferences, setPreferences] = useState<Preferences>({
    maxHistorySize: 50,
    defaultShell: "/bin/zsh",
    shellProfile: "",
    debugMode: false,
  });

  // Load preferences on component mount
  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      const prefs = getPreferenceValues<Preferences>();
      setPreferences(prefs);
    } catch {
      console.log("Using default preferences");
    }
  };

  // AI prompt for generating CLI commands
  const aiPrompt = `You are a CLI command generator for macOS. Generate ONLY the complete, valid command that accomplishes the user's request.

Rules:
- Return ONLY the command, no explanations, quotes, or markdown
- Use complete, valid Unix/macOS commands
- For "show/list folders": use "ls -la ~/Desktop" or "find ~/Desktop -type d -maxdepth 1"
- For "show/list files": use "ls -la" or "find . -type f"
- For file operations, use absolute paths when mentioning specific directories
- Prefer safer commands (avoid rm -rf unless specifically requested)
- Always include proper flags and arguments
- Test common patterns:
  * "show folders on desktop" → "ls -la ~/Desktop"
  * "list all files" → "ls -la"
  * "find pdf files" → "find . -name "*.pdf""

User request: ${searchText}

Generate the exact command:`;

  const { data: aiResponse, isLoading: aiLoading, revalidate } = useAI(aiPrompt, {
    execute: false,
  });

  const getFallbackCommand = (request: string): string | null => {
    const lowerRequest = request.toLowerCase();
    
    // Common fallback patterns
    if (lowerRequest.includes("show") && lowerRequest.includes("folder") && lowerRequest.includes("desktop")) {
      return "ls -la ~/Desktop";
    }
    if (lowerRequest.includes("list") && lowerRequest.includes("desktop")) {
      return "ls -la ~/Desktop";
    }
    if (lowerRequest.includes("current directory") || lowerRequest.includes("this folder")) {
      return "ls -la";
    }
    if (lowerRequest.includes("disk usage") || lowerRequest.includes("disk space")) {
      return "df -h";
    }
    if (lowerRequest.includes("processes") || lowerRequest.includes("running")) {
      return "ps aux";
    }
    
    return null;
  };

  const generateAndExecuteCommand = async () => {
    if (!searchText.trim()) {
      showToast({
        style: Toast.Style.Failure,
        title: "Please enter a request",
        message: "Describe what you want to accomplish",
      });
      return;
    }

    // Try fallback first for common patterns
    const fallbackCommand = getFallbackCommand(searchText);
    if (fallbackCommand) {
      executeCommand(fallbackCommand);
      return;
    }

    setIsGenerating(true);
    
    try {
      await showToast({
        style: Toast.Style.Animated,
        title: "Generating command...",
        message: searchText,
      });

      // Trigger AI generation
      revalidate();
    } catch (error) {
      setIsGenerating(false);
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to generate command",
        message: "Please try again",
      });
    }
  };

  // Auto-execute when AI response arrives
  useEffect(() => {
    if (aiResponse && isGenerating) {
      let cleanCommand = aiResponse
        .trim()
        .replace(/^```[\w]*\n?/, "") // Remove opening code block
        .replace(/\n?```$/, "") // Remove closing code block
        .replace(/^Command:\s*/, "") // Remove "Command:" prefix
        .replace(/^Generate the exact command:\s*/, "") // Remove prompt echo
        .replace(/^Here's the command:\s*/, "") // Remove explanation
        .replace(/^`(.*)`$/, "$1") // Remove single backticks
        .trim();
      
      // Validate the command is not empty or malformed
      if (!cleanCommand || cleanCommand.length < 2 || cleanCommand.endsWith("-") || cleanCommand.endsWith("--")) {
        setIsGenerating(false);
        showToast({
          style: Toast.Style.Failure,
          title: "Invalid command generated",
          message: "Please try rephrasing your request",
        });
        return;
      }
      
      setIsGenerating(false);
      executeCommand(cleanCommand);
    }
  }, [aiResponse, isGenerating]);

  const saveCommandHistory = async (command: string, output?: string, error?: string, executionPath?: string) => {
    try {
      const history = await LocalStorage.getItem<string>("commandHistory");
      const commandHistory: CommandHistory[] = history ? JSON.parse(history) : [];
      
      const now = Date.now();
      const existingIndex = commandHistory.findIndex((item) => item.command === command);

      if (existingIndex !== -1) {
        commandHistory[existingIndex] = {
          ...commandHistory[existingIndex],
          lastUsed: now,
          useCount: commandHistory[existingIndex].useCount + 1,
          output,
          error,
          executionPath,
        };
      } else {
        commandHistory.push({
          command,
          lastUsed: now,
          useCount: 1,
          output,
          error,
          executionPath,
        });
      }

      // Sort by most recently used first
      commandHistory.sort((a, b) => b.lastUsed - a.lastUsed);

      // Limit history size
      if (commandHistory.length > preferences.maxHistorySize) {
        commandHistory.splice(preferences.maxHistorySize);
      }

      await LocalStorage.setItem("commandHistory", JSON.stringify(commandHistory));
    } catch (error) {
      console.error("Failed to save command history:", error);
    }
  };

  const executeCommand = async (command: string) => {
    setIsExecuting(true);

    try {
      await showToast({
        style: Toast.Style.Animated,
        title: "Executing command...",
        message: command,
      });

      const finderPath = await getCurrentFinderPath();
      let finalCommand = command;

      if (preferences.shellProfile && preferences.shellProfile.trim()) {
        finalCommand = `source ${preferences.shellProfile} && ${command}`;
      } else {
        if (preferences.defaultShell.includes("zsh")) {
          finalCommand = `source ~/.zshrc 2>/dev/null; ${command}`;
        } else if (preferences.defaultShell.includes("bash")) {
          finalCommand = `source ~/.bash_profile 2>/dev/null || source ~/.bashrc 2>/dev/null; ${command}`;
        }
      }

      if (finderPath && finderPath.trim()) {
        finalCommand = `cd "${finderPath}" && ${finalCommand}`;
      }

      const { stdout, stderr } = await execAsync(finalCommand, {
        shell: preferences.defaultShell,
        timeout: 30000,
        env: {
          ...process.env,
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USER: process.env.USER,
          NVM_DIR: process.env.NVM_DIR || `${process.env.HOME}/.nvm`,
        },
      });

      if (stderr) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Command completed with warnings",
          message: stderr,
        });
      } else {
        await showToast({
          style: Toast.Style.Success,
          title: "Command executed successfully",
        });
      }

      await saveCommandHistory(command, stdout, stderr, finderPath || undefined);

      // Show detail view with the command result
      const executedCommand = {
        command,
        lastUsed: Date.now(),
        useCount: 1,
        output: stdout,
        error: stderr,
        executionPath: finderPath || undefined,
      };
      setSelectedCommand(executedCommand);
      setShowResult(true);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      let suggestion = "";

      // Provide helpful suggestions for common issues
      if (errorMessage.includes("command not found")) {
        suggestion = "Try setting a shell profile in preferences (e.g., ~/.zshrc)";
      } else if (errorMessage.includes("permission denied")) {
        suggestion = "Check if the command requires elevated permissions";
      }
      
      await showToast({
        style: Toast.Style.Failure,
        title: "Command failed",
        message: suggestion ? `${errorMessage}\n\n💡 ${suggestion}` : errorMessage,
      });

      await saveCommandHistory(command, undefined, errorMessage);

      // Show detail view with the error result
      const failedCommand = {
        command,
        lastUsed: Date.now(),
        useCount: 1,
        output: undefined,
        error: errorMessage,
        executionPath: undefined,
      };
      setSelectedCommand(failedCommand);
      setShowResult(true);
    } finally {
      setIsExecuting(false);
    }
  };

  // Show execution result
  if (showResult && selectedCommand) {
    const formatOutput = (output: string | undefined, error: string | undefined) => {
      if (error) {
        return `## ❌ Error\n\n\`\`\`\n${error}\n\`\`\``;
      }
      if (output !== undefined) {
        return `## ✅ Output\n\n\`\`\`\n${output || "No output"}\n\`\`\``;
      }
      return `## ℹ️ No Output Data\n\nThis command was executed before output tracking was enabled.`;
    };

    const markdown = `
# ${selectedCommand.command}

**Generated from:** "${searchText}"
**Last executed:** ${new Date(selectedCommand.lastUsed).toLocaleString()}
**Execution Path:** ${selectedCommand.executionPath || "N/A"}

---

${formatOutput(selectedCommand.output, selectedCommand.error)}
    `.trim();

    return (
      <Detail
        markdown={markdown}
        actions={
          <ActionPanel>
            <Action
              title="Generate Another Command"
              icon={Icon.ArrowLeft}
              onAction={() => {
                setShowResult(false);
                setSelectedCommand(null);
                setSearchText("");
              }}
            />
            <Action
              title="Execute Again"
              icon={Icon.Play}
              onAction={() => executeCommand(selectedCommand.command)}
            />
          </ActionPanel>
        }
      />
    );
  }

  const isLoading = isGenerating || aiLoading || isExecuting;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Tell me, what command do you want to generate?"
      searchText={searchText}
      onSearchTextChange={setSearchText}
      actions={
        <ActionPanel>
          <Action
            title="Generate & Execute Command"
            icon={Icon.Wand}
            onAction={generateAndExecuteCommand}
          />
        </ActionPanel>
      }
    >
      {searchText.trim() && !isLoading && (
        <List.Item
          title={`Generate command for: "${searchText}"`}
          subtitle="Press Enter to generate and execute"
          icon={{ source: Icon.Wand, tintColor: Color.Blue }}
          actions={
            <ActionPanel>
              <Action
                title="Generate & Execute Command"
                icon={Icon.Wand}
                onAction={generateAndExecuteCommand}
              />
            </ActionPanel>
          }
        />
      )}

      {!searchText.trim() && !isLoading && (
        <List.EmptyView
          icon={Icon.Wand}
          title="Ask Commander"
          description="Describe what you want to do and I'll generate and execute the command for you"
        />
      )}

      {isLoading && (
        <List.Item
          title={
            isGenerating || aiLoading
              ? "🤖 Generating command with AI..."
              : "⚡ Executing command..."
          }
          subtitle={searchText}
          icon={{ source: Icon.Clock, tintColor: Color.Orange }}
        />
      )}
    </List>
  );
} 