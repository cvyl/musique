import {
	SlashCommandBuilder,
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	ButtonBuilder,
	ButtonStyle,
	ActionRowBuilder,
	ComponentType,
	ButtonInteraction,
	EmbedBuilder
} from 'discord.js'
import ytsr from '@distube/ytsr'
import {
	getVoiceConnection,
	joinVoiceChannel,
	createAudioPlayer,
	createAudioResource,
	AudioPlayerStatus,
	StreamType,
	NoSubscriberBehavior,
	AudioPlayer
} from '@discordjs/voice'
import ytdl from '@distube/ytdl-core'
import { debugLog } from '../utils/debug' // Import debugLog from debug.ts

// Store queues and players per guild (server)
const queues = new Map<string, { songs: string[]; loopEnabled: boolean }>()
const players = new Map<string, AudioPlayer>()

// Define buttons and controls upfront
const createControls = (guildId: string, player: AudioPlayer) => {
	const queueData = queues.get(guildId)!
	const isPaused = player.state.status === AudioPlayerStatus.Paused

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(`stop-${guildId}`).setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId(`pause-${guildId}`)
			.setLabel(isPaused ? '▶️ Resume' : '⏸️ Pause')
			.setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(`skip-${guildId}`).setLabel('⏭️ Skip').setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId(`loop-${guildId}`)
			.setLabel(queueData.loopEnabled ? '🔁 Loop: On' : '🔁 Loop: Off')
			.setStyle(queueData.loopEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
	)
}

export const data = new SlashCommandBuilder()
	.setName('play')
	.setDescription('Plays a song based on a URL or search query')
	.addStringOption((option) =>
		option
			.setName('input')
			.setDescription('The URL of the song you want to play or a search term')
			.setRequired(true)
			.setAutocomplete(true)
	)

export async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guild) {
		await interaction.reply('This command can only be used in a server!')
		return
	}

	const guildId = interaction.guildId!
	const input = interaction.options.getString('input')

	debugLog('PLAY', `Executing play command in guild ${guildId} with input: ${input}`)

	// Initialize the queue and loop state for this guild if not already
	if (!queues.has(guildId)) {
		queues.set(guildId, { songs: [], loopEnabled: false })
	}

	const queueData = queues.get(guildId)!

	if (ytdl.validateURL(input!)) {
		debugLog('PLAY', 'Input is a valid YouTube URL, attempting to play directly.')
		queueData.songs.push(input!)
		if (!players.get(guildId)) {
			await playNext(interaction)
		} else {
			const songInfo = await ytdl.getInfo(input!)
			const embed = createQueueEmbed(songInfo)
			await interaction.reply({ embeds: [embed] })
		}
	} else {
		debugLog('PLAY', 'Input is not a valid YouTube URL, treating it as a search term.')
	}

	printDebugQueue()
}

export async function autocomplete(interaction: AutocompleteInteraction) {
	debugLog('SEARCH', 'Received autocomplete interaction.')

	const focusedValue = interaction.options.getFocused()

	if (!focusedValue.trim()) {
		debugLog('SEARCH', 'Empty search query, returning empty list.')
		return interaction.respond([]) // Return an empty list
	}

	debugLog('SEARCH', `Autocomplete search query: ${focusedValue}`)

	try {
		// Fetch search results
		const searchResults = await ytsr(focusedValue, { limit: 10 })
		const videos = searchResults.items.filter((item: ytsr.Video) => item.type === 'video')

		// Prepare choices for the autocomplete response
		const choices = videos.map((video: ytsr.Video) => ({
			name: `${video.name} (${video.duration})`,
			value: video.url
		}))

		// Respond to the interaction immediately
		await interaction.respond(choices)

		debugLog('SEARCH', 'Autocomplete search results:', '\n\t=>', choices.map((choice) => choice.name).join('\n\t=> '))
	} catch (err) {
		// Log and ignore common errors
		if (/DiscordAPIError\[(40060|10062|50035|50068)\]/.test(err.toString())) {
			debugLog('ERROR', 'Failed to respond to autocomplete interaction, this is common and can be ignored:', err)
		}

		// If an error occurs, respond with an empty list to avoid unhandled interaction errors
		try {
			await interaction.respond([])
		} catch (err) {
			debugLog('SEARCH', 'Failed to respond to autocomplete interaction:', err)
		}
	}
}

async function playNext(interaction: ChatInputCommandInteraction) {
	const guildId = interaction.guildId!
	const guildQueue = queues.get(guildId)!
	if (guildQueue.songs.length === 0) return

	const URL = guildQueue.songs.shift()!
	await playSong(interaction, URL)
}

async function playSong(interaction: ChatInputCommandInteraction, URL: string) {
	const guildId = interaction.guildId!

	// Defer the interaction reply
	if (!interaction.deferred && !interaction.replied) {
		await interaction.deferReply()
	}

	let connection = getVoiceConnection(guildId)
	const userChannel = interaction.guild?.members.cache.get(interaction.user.id)?.voice.channel

	// Check if the bot is actually in the voice channel
	if (!connection || !userChannel || connection.joinConfig.channelId !== userChannel.id) {
		if (userChannel) {
			connection = joinVoiceChannel({
				channelId: userChannel.id,
				guildId: userChannel.guild.id,
				adapterCreator: userChannel.guild.voiceAdapterCreator
			})
		} else {
			debugLog('ERROR', `User ${interaction.user.id} in guild ${guildId} is not in a voice channel!`)
			await interaction.editReply('You need to join a voice channel first!')
			return
		}
	}

	if (players.get(guildId)) {
		players.get(guildId)!.stop()
	}

	const player = createAudioPlayer({
		behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
	})
	players.set(guildId, player)

	try {
		const songInfo = await ytdl.getInfo(URL)
		const stream = ytdl(URL, {
			filter: 'audioonly',
			quality: 'highestaudio',
			highWaterMark: 1 << 25
		})
		const resource = createAudioResource(stream, {
			inputType: StreamType.Arbitrary
		})

		player.play(resource)
		connection.subscribe(player)

		const nowPlayingEmbed = createNowPlayingEmbed(songInfo)
		const controls = createControls(guildId, player) // Pass the player here

		const playingMessage = await interaction.followUp({
			embeds: [nowPlayingEmbed],
			components: [controls]
		})

		const buttonFilter = (i: ButtonInteraction) => i.customId.endsWith(guildId) && i.user.id === interaction.user.id
		const collector = playingMessage.createMessageComponentCollector({
			filter: buttonFilter,
			componentType: ComponentType.Button,
			time: Number(songInfo.videoDetails.lengthSeconds) * 1000
		})

		collector.on('collect', async (i: ButtonInteraction) =>
			handleButtonInteraction(i, guildId, player, interaction, playingMessage)
		)

		player.on(AudioPlayerStatus.Idle, () => {
			if (queues.get(guildId)!.loopEnabled) {
				queues.get(guildId)!.songs.unshift(URL)
			}
			if (queues.get(guildId)!.songs.length > 0) {
				playNext(interaction)
			} else {
				players.delete(guildId)
				connection?.disconnect()
			}
		})
	} catch (err) {
		debugLog('ERROR', 'Error playing song:', err)
		await interaction.editReply('Failed to play the song!')
	}
}

async function handleButtonInteraction(
	i: ButtonInteraction,
	guildId: string,
	player: AudioPlayer,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	interaction: ChatInputCommandInteraction,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	playingMessage: unknown
) {
	const queueData = queues.get(guildId)!

	switch (i.customId) {
		case `stop-${guildId}`:
			queueData.songs.length = 0
			player.stop()
			queueData.loopEnabled = false
			debugLog('BUTTON', `Stopped the music and cleared the queue for guild ${guildId}.`)
			await i.update({
				content: 'Stopped the music and cleared the queue.',
				components: []
			})
			break
		case `pause-${guildId}`:
			debugLog('BUTTON', `Pause button clicked for guild ${guildId}.`)
			if (player.state.status === AudioPlayerStatus.Playing) {
				player.pause()
			} else if (player.state.status === AudioPlayerStatus.Paused) {
				player.unpause()
			}
			await i.update({ components: [createControls(guildId, player)] }) // Update controls to reflect the new state
			break
		case `skip-${guildId}`:
			debugLog('BUTTON', `Skip button clicked for guild ${guildId}.`)
			player.stop()
			queueData.loopEnabled = false
			await i.update({ content: 'Skipped the song.', components: [] })
			break
		case `loop-${guildId}`:
			debugLog('BUTTON', `Loop button clicked for guild ${guildId}.`)
			queueData.loopEnabled = !queueData.loopEnabled
			await i.update({
				content: `Looping is now ${queueData.loopEnabled ? 'enabled' : 'disabled'}.`,
				components: [createControls(guildId, player)]
			})
			break
	}
}

function createNowPlayingEmbed(songInfo: ytdl.videoInfo) {
	return new EmbedBuilder()
		.setTitle(`Now Playing: ${songInfo.videoDetails.title}`)
		.setURL(songInfo.videoDetails.video_url)
		.setThumbnail(songInfo.videoDetails.thumbnails[0].url)
		.addFields(
			{
				name: 'Duration',
				value: `${Math.floor(Number(songInfo.videoDetails.lengthSeconds) / 60)}:${Number(songInfo.videoDetails.lengthSeconds) % 60}`,
				inline: true
			},
			{
				name: 'Channel',
				value: `${songInfo.videoDetails.author.name}`,
				inline: true
			}
		)
		.setColor(0x9b30ff)
}

function createQueueEmbed(songInfo: ytdl.videoInfo) {
	return new EmbedBuilder()
		.setTitle(`Added to Queue: ${songInfo.videoDetails.title}`)
		.setURL(songInfo.videoDetails.video_url)
		.setThumbnail(songInfo.videoDetails.thumbnails[0].url)
		.addFields(
			{
				name: 'Duration',
				value: `${Math.floor(Number(songInfo.videoDetails.lengthSeconds) / 60)}:${Number(songInfo.videoDetails.lengthSeconds) % 60}`,
				inline: true
			},
			{
				name: 'Channel',
				value: `${songInfo.videoDetails.author.name}`,
				inline: true
			}
		)
		.setColor(0x9b30ff)
}

// Helper function for debugging the queue state
function printDebugQueue() {
	queues.forEach((queueData, guildId) => {
		debugLog('QUEUE', `Queue for guild ${guildId}:`, queueData.songs)
		debugLog('QUEUE', `Loop enabled: ${queueData.loopEnabled}`)
	})
}
