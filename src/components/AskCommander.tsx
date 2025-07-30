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
  useNavigation,
} from "@raycast/api";
import { useAI } from "@raycast/utils";
import { LocalStorage } from "@raycast/api";
import { Preferences } from "../types";
import Commander from "./Commander";

export default function AskCommander() {
  const [searchText, setSearchText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>({
    maxHistorySize: 50,
    defaultShell: "/bin/zsh",
    shellProfile: "",
    debugMode: false,
  });

  const { push } = useNavigation();

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
      navigateToCommander(fallbackCommand);
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

  const navigateToCommander = async (command: string) => {
    try {
      // Store the generated command for Commander to pick up
      await LocalStorage.setItem("generatedCommand", command);
      
      await showToast({
        style: Toast.Style.Success,
        title: "Command generated!",
        message: `Opening Commander with: ${command}`,
      });

      // Navigate to Commander component
      push(<Commander />);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to navigate",
        message: "Could not open Commander",
      });
    }
  };

  // Auto-navigate to Commander when AI response arrives
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
      navigateToCommander(cleanCommand);
    }
  }, [aiResponse, isGenerating]);



  const isLoading = isGenerating || aiLoading;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Tell me, what command do you want to generate?"
      searchText={searchText}
      onSearchTextChange={setSearchText}
      actions={
        <ActionPanel>
          <Action
            title="Generate & Open in Commander"
            icon={Icon.Wand}
            onAction={generateAndExecuteCommand}
          />
        </ActionPanel>
      }
    >
      {searchText.trim() && !isLoading && (
        <List.Item
          title={`Generate command for: "${searchText}"`}
          subtitle="Press Enter to generate and open in Commander"
          icon={{ source: Icon.Wand, tintColor: Color.Blue }}
          actions={
            <ActionPanel>
              <Action
                title="Generate & Open in Commander"
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
          description="Describe what you want to do and I'll generate the command and open it in Commander for you"
        />
      )}

      {isLoading && (
        <List.Item
          title="🤖 Generating command with AI..."
          subtitle={searchText}
          icon={{ source: Icon.Clock, tintColor: Color.Orange }}
        />
      )}
    </List>
  );
} 