import { DEBUG_MODE } from '../config'

/**
 * Logs a debug message with a custom prefix if debug mode is enabled.
 * @param {string} category - The category of the debug message (e.g., PLAY, SEARCH, ERROR, etc.).
 * @param {...unknown} message - The message(s) to log.
 */
export function debugLog(category: string, ...message: unknown[]) {
	if (DEBUG_MODE) {
		let color

		switch (category.toUpperCase()) {
			case 'ERROR':
				color = '\x1b[31m' // Red for errors
				break
			case 'READY':
				color = '\x1b[32m' // Green for ready messages
				break
			case 'PLAY':
			case 'SEARCH':
			case 'QUEUE':
				color = '\x1b[35m' // Magenta for music-related messages
				break
			default:
				color = '\x1b[36m' // Cyan for other messages
				break
		}

		const resetColor = '\x1b[0m'
		const messageColor = '\x1b[90m' // Gray for message content
		console.log(`${color}[DEBUG/${category}]${resetColor}${messageColor}`, ...message)
	}
}
