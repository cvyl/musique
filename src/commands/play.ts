import {
	SlashCommandBuilder,
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	ButtonBuilder,
	ButtonStyle,
	ActionRowBuilder,
	ComponentType,
	ButtonInteraction,
	EmbedBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	ActivityType
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

const queue: string[] = []
let currentPlayer: AudioPlayer | null = null
let loopEnabled = false // New variable to track loop state
const debugMode = true // Enable debugging output

// Define buttons and controls upfront
const createControls = () =>
	new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('stop')
			.setLabel('⏹️ Stop')
			.setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId('pause')
			.setLabel('⏸️ Pause')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('skip')
			.setLabel('⏭️ Skip')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId('loop')
			.setLabel(loopEnabled ? '🔁 Loop: On' : '🔁 Loop: Off')
			.setStyle(loopEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
	)

export const data = new SlashCommandBuilder()
	.setName('play')
	.setDescription('Plays a song based on a URL or search query')
	.addStringOption(
		(option) =>
			option
				.setName('input')
				.setDescription('The URL of the song you want to play or a search term')
				.setRequired(true)
				.setAutocomplete(true) // Enable autocomplete for this option
	)

export async function execute(interaction: ChatInputCommandInteraction) {
	if (!interaction.guild) {
		await interaction.reply('This command can only be used in a server!')
		return
	}

	const input = interaction.options.getString('input')

	if (debugMode) console.log(`Executing play command with input: ${input}`)

	if (ytdl.validateURL(input!)) {
		if (debugMode)
			console.log('Input is a valid YouTube URL, attempting to play directly.')
		queue.push(input!)
		if (!currentPlayer) {
			await playNext(interaction)
		} else {
			const songInfo = await ytdl.getInfo(input!)

			const embed = new EmbedBuilder()
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

			await interaction.reply({ embeds: [embed] })
		}
	} else {
		if (debugMode)
			console.log(
				'Input is not a valid YouTube URL, treating it as a search term.'
			)
		await searchAndSelect(interaction, input!)
	}
}

export async function autocomplete(interaction: AutocompleteInteraction) {
	if (debugMode) console.log('Autocomplete interaction received')

	const focusedValue = interaction.options.getFocused()

	if (!focusedValue.trim()) {
		if (debugMode) console.log('Focused value is empty, skipping autocomplete.')
		return interaction.respond([]) // Return an empty list
	}

	if (debugMode)
		console.log(`Autocomplete triggered with focused value: ${focusedValue}`)

	try {
		const searchResults = await ytsr(focusedValue, { limit: 5 })
		const videos = searchResults.items.filter(
			(item: ytsr.Video) => item.type === 'video'
		)

		const choices = videos.map((video: ytsr.Video) => ({
			name: `${video.name} (${video.duration})`,
			value: video.url
		}))

		await interaction.respond(choices)

		if (debugMode) console.log('Autocomplete response sent successfully.')
	} catch {
		console.error('Autocomplete search failed:')
		await interaction.respond([])
	}
}

async function searchAndSelect(
	interaction: ChatInputCommandInteraction,
	query: string
) {
	const searchResults = await ytsr(query, { limit: 5 })
	const videos = searchResults.items.filter(
		(item: ytsr.Video) => item.type === 'video'
	)

	if (videos.length === 0) {
		await interaction.reply('No search results found!')
		return
	}

	const options = videos.map((video: ytsr.Video) => ({
		label: video.name,
		description: video.duration,
		value: video.url
	}))

	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId('song_select')
		.setPlaceholder('Choose a song...')
		.addOptions(options)

	const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		selectMenu
	)

	await interaction.reply({
		content: 'Select a song from the dropdown list:',
		components: [row]
	})

	const filter = (i: StringSelectMenuInteraction) =>
		i.customId === 'song_select' && i.user.id === interaction.user.id

	try {
		const selection = await interaction.channel?.awaitMessageComponent({
			filter,
			componentType: ComponentType.StringSelect,
			time: 15000
		})

		if (selection) {
			const selectedVideoURL = selection.values[0]
			await playSong(interaction, selectedVideoURL)
			await interaction.deleteReply() // Delete the initial message with the dropdown
		}
	} catch {
		if (!interaction.replied && !interaction.deferred) {
			await interaction.editReply({
				content: 'Selection timed out!',
				components: []
			})
		}
	}
}

async function playNext(interaction: ChatInputCommandInteraction) {
	if (queue.length === 0) return

	const URL = queue.shift()!
	await playSong(interaction, URL)
}

async function playSong(interaction: ChatInputCommandInteraction, URL: string) {
	// Check if the interaction has already been deferred
	if (!interaction.deferred && !interaction.replied) {
		await interaction.deferReply()
	}

	let connection = getVoiceConnection(interaction.guildId!)
	const userChannel = interaction.guild?.members.cache.get(interaction.user.id)
		?.voice.channel

	// If the bot is not already connected, join the user's channel
	if (!connection) {
		if (!userChannel) {
			await interaction.editReply('You need to join a voice channel first!')
			return
		}
		connection = joinVoiceChannel({
			channelId: userChannel.id,
			guildId: userChannel.guild.id,
			adapterCreator: userChannel.guild.voiceAdapterCreator
		})
	} else {
		// If the bot is already in a different channel, reply with an error
		const botChannel = connection.joinConfig.channelId
		if (userChannel && botChannel !== userChannel.id) {
			await interaction.editReply('I am already in another voice channel!')
			return
		}
	}

	if (currentPlayer) {
		currentPlayer.stop() // Stop any currently playing song
	}

	const player = createAudioPlayer({
		behaviors: {
			noSubscriber: NoSubscriberBehavior.Pause
		}
	})

	currentPlayer = player

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

		// Update bot presence
		interaction.client.user?.setActivity(`${songInfo.videoDetails.title}`, {
			type: ActivityType.Listening
		})

		const nowPlayingEmbed = new EmbedBuilder()
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

		const controls = createControls()

		const playingMessage = await interaction.followUp({
			embeds: [nowPlayingEmbed],
			components: [controls]
		})

		// Implement the component collector for button interactions
		const buttonFilter = (i: ButtonInteraction) =>
			i.user.id === interaction.user.id

		const collector = playingMessage.createMessageComponentCollector({
			filter: buttonFilter,
			componentType: ComponentType.Button,
			time: Number(songInfo.videoDetails.lengthSeconds) * 1000
		})

		collector.on('collect', async (i: ButtonInteraction) => {
			switch (i.customId) {
				case 'stop':
					queue.length = 0 // Clear the queue
					player.stop()
					await interaction.client.user?.setActivity('')
					await i.reply('Stopped the music and cleared the queue.')
					loopEnabled = false
					break
				case 'pause':
					if (player.state.status === AudioPlayerStatus.Playing) {
						player.pause()
						await i.reply('Paused the music.')
					} else if (player.state.status === AudioPlayerStatus.Paused) {
						player.unpause()
						await i.reply('Resumed the music.')
					}
					break
				case 'skip':
					player.stop() // Stop the current song, automatically plays the next
					interaction.client.user?.setActivity('')
					await i.reply('Skipped the song.')
					loopEnabled = false
					break
				case 'loop':
					loopEnabled = !loopEnabled
					await i.update({
						components: [createControls()] // Update the buttons with the new loop state
					})
					break
				default:
					await i.reply('Invalid button.')
					break
			}
		})

		player.on(AudioPlayerStatus.Idle, () => {
			if (loopEnabled) {
				queue.unshift(URL) // Re-add the current song to the front of the queue
			}
			if (queue.length > 0) {
				playNext(interaction)
			} else {
				currentPlayer = null
				connection?.disconnect()
				interaction.client.user?.setActivity('')
			}
		})
	} catch (err) {
		console.error('Error playing song:', err)
		await interaction.editReply('Failed to play the song!')
	}
}
