// Add seconds to a date
function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000)
}

// Subtract seconds from a date
function subtractSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() - seconds * 1000)
}

function isValidDate(d: Date): boolean {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

// Safely parse JSON with better error handling
function safeJsonParse(jsonString: string): { success: boolean; data?: any; error?: string } {
  try {
    // Check if input is a string
    if (typeof jsonString !== 'string') {
      return { success: false, error: 'Input is not a string' }
    }

    // Check if string is empty
    if (!jsonString.trim()) {
      return { success: false, error: 'Input is empty' }
    }

    // Check if string looks like HTML (common error response)
    if (jsonString.trim().startsWith('<')) {
      return { success: false, error: 'Input appears to be HTML, not JSON' }
    }

    const parsed = JSON.parse(jsonString)
    return { success: true, data: parsed }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown parsing error' }
  }
}

export { addSeconds, isValidDate, safeJsonParse, subtractSeconds }
