import {
    Client,
    Events,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
} from 'discord.js';
import 'dotenv/config';
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Tracks message IDs already moved to prevent double-moves
const movedMessages = new Set();

async function moveMessage(message, targetChannel) {
    const contextEmbed = new EmbedBuilder()
        .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
        .setFooter({ text: `From #${message.channel.name}` })
        .setTimestamp(message.createdAt);

    if (message.content) contextEmbed.setDescription(message.content);

    // Forward original embeds (link previews, bot embeds) directly
    const embeds = [contextEmbed, ...message.embeds.map(e => EmbedBuilder.from(e))];

    // Re-upload attachments so they survive the original message deletion
    const files = [...message.attachments.values()].map(a => a.url);

    await targetChannel.send({ embeds, files });
    await message.delete();
}

client.once(Events.ClientReady, readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (user.bot) return;

    // Guard before any await — prevents race condition where two reaction
    // events both pass the check before either adds to the Set
    const messageId = reaction.message.id;
    if (movedMessages.has(messageId)) return;

    try {
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();
    } catch (err) {
        console.error('Failed to fetch reaction/message:', err);
        return;
    }

    const message = reaction.message;
    const guild = message.guild;
    const channelName = message.channel.name;

    if (channelName === 'manuel') {
        const totalReactions = message.reactions.cache.reduce((sum, r) => sum + r.count, 0);
        if (totalReactions >= 2) {
            if (movedMessages.has(message.id)) return;
            movedMessages.add(message.id);
            const target = guild.channels.cache.find(c => c.name === 'coup-de-coeur');
            if (!target) return console.error('Channel #coup-de-coeur not found');
            await moveMessage(message, target);
        }
    } else if (channelName !== 'coup-de-coeur') {
        if (movedMessages.has(message.id)) return;
        movedMessages.add(message.id);
        const target = guild.channels.cache.find(c => c.name === 'manuel');
        if (!target) return console.error('Channel #manuel not found');
        await moveMessage(message, target);
    }
});


client.login(process.env.DISCORD_TOKEN);
