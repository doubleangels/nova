const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');

module.exports = {
    /**
     * Context menu command for mocking a selected message.
     * This allows users to right-click a message and select "Mock" to mock it.
     */
    data: new ContextMenuCommandBuilder()
        .setName('Mock')
        .setType(ApplicationCommandType.Message), // This makes it a right-click message command

    /**
     * Executes the mock command on a selected message.
     * @param {import('discord.js').CommandInteraction} interaction - The interaction object from Discord.
     */
    async execute(interaction) {
        // Ensure the interaction is from a message context menu
        if (!interaction.isMessageContextMenuCommand()) return;

        // Get the message that was selected
        const message = interaction.targetMessage;

        // Prevent mocking an empty message or bot messages
        if (!message.content || message.author.bot) {
            return await interaction.reply({ 
                content: "I can't mock that, bruh.", 
                ephemeral: true 
            });
        }

        // Convert message text into mocking case (random uppercase/lowercase)
        const mockedText = message.content.split('')
            .map(char => /[a-zA-Z]/.test(char) 
                ? (Math.random() > 0.5 ? char.toUpperCase() : char.toLowerCase()) 
                : char)
            .join('');

        // Brutal, public roast responses
        const responses = [
            `Oh wow, you really thought **"${mockedText}"** was a *good* idea?`,
            `I ran **"${mockedText}"** through an IQ test. The results just said **"why tho?"**`,
            `I showed **"${mockedText}"** to a monk, and he **broke his vow of silence** just to call you stupid.`,
            `Your last two brain cells must’ve been boxing each other when you typed **"${mockedText}"**.`,
            `**"${mockedText}"**? Bro, even my toaster could generate a better sentence.`,
            `Your keyboard deserves an apology for what you just typed: **"${mockedText}"**.`,
            `Even Grammarly waved a white flag when I pasted **"${mockedText}"** in.`,
            `I sent **"${mockedText}"** to NASA. They confirmed it was the reason aliens won’t visit us.`,
            `Even Wikipedia flagged **"${mockedText}"** as "highly unreliable."`,
            `I whispered **"${mockedText}"** to a plant, and it **immediately withered.**`,
            `Your teacher saw **"${mockedText}"** and immediately **quit their job.**`,
            `I tried to print **"${mockedText}"**, but the printer **filed for divorce.**`,
            `If **"${mockedText}"** was a crime, it’d be **public indecency against intelligence.**`,
            `I put **"${mockedText}"** in a fortune cookie. It just said **"nah fam, you doomed."**`,
            `I ran **"${mockedText}"** through Google Translate, and it translated to "I need help."`,
            `Your ancestors survived plagues, wars, and famine for you to type **"${mockedText}"**?`,
            `I showed **"${mockedText}"** to an AI detector. It classified it as *Neanderthal scribbles.*`,
            `Even ChatGPT is judging you for **"${mockedText}"**.`,
            `I framed **"${mockedText}"** in a museum titled **"The Dumbest Things Ever Said."**`,
            `Even your **autocorrect** gave up on you when you typed **"${mockedText}"**.`,
            `**"${mockedText}"** was so bad, even my WiFi disconnected itself.`,
            `I put **"${mockedText}"** through ChatGPT, and it responded with **"I'm not paid enough for this."**`,
            `I tried to share **"${mockedText}"**, but Discord flagged it as *harmful content*.`,
            `I whispered **"${mockedText}"** into my phone. Now Siri won’t talk to me anymore.`,
            `I sent **"${mockedText}"** to an old typewriter. It **short-circuited in self-defense.**`,
            `Your ancestors are looking down at **"${mockedText}"** and regretting everything.`,
            `Bro, even my goldfish could generate a better thought, and he’s been dead for **three years.**`,
            `**"${mockedText}"** is proof that *some people peaked in kindergarten.*`,
            `I ran **"${mockedText}"** through an AI detector. It classified it as *monkey keyboard smash.*`,
            `Bro, I tried showing **"${mockedText}"** to my dog. He left and never came back.`,
            `I showed **"${mockedText}"** to a scientist. He unlearned everything he knew.`,
            `Even a CAPTCHA test would refuse to accept **"${mockedText}"** as human input.`,
            `**"${mockedText}"** is so bad, I got a notification saying **"intelligence levels critically low."**`,
            `I took **"${mockedText}"** to an ancient library. The books **caught fire on their own.**`,
            `Your keyboard was screaming for help while you were typing **"${mockedText}"**.`,
            `I showed **"${mockedText}"** to an astrologer, and they said even the stars disapprove.`,
            `If **"${mockedText}"** was a book, it’d be titled **"How to Fail at Everything."**`,
            `The **CIA** just classified **"${mockedText}"** as a **threat to national security.**`,
            `I ran **"${mockedText}"** through an IQ test. It scored **"404: Intelligence Not Found."**`,
            `Bro, my pet rock has better thoughts than **"${mockedText}"**.`,
            `Even my Roomba rejected **"${mockedText}"**. And that thing eats dust for a living.`,
            `Your WiFi signal dropped the moment you sent **"${mockedText}"**. Even the internet is ashamed.`,
            `I took **"${mockedText}"** to a comedy club. They thought it was a joke.`,
            `If **"${mockedText}"** was a candle scent, it’d be **regret and disappointment.**`,
            `Even Discord flagged **"${mockedText}"** as "potentially harmful stupidity."`,
            `I whispered **"${mockedText}"** to an AI, and it started questioning its existence.`,
            `NASA just confirmed that **"${mockedText}"** set the **human race back 10 years.**`,
            `Bro, even my calculator has better logic than **"${mockedText}"**.`,
            `If **"${mockedText}"** was a test answer, even *multiple choice* would fail you.`,
            `Your **Google search history** is **embarrassing**, but **"${mockedText}"** made it worse.`,
            `I tried to send **"${mockedText}"** via email. Gmail auto-classified it as spam.`,
            `Even Grammarly refused to correct **"${mockedText}"**, it just said **"seek help."**`,
            `I printed **"${mockedText}"**, and my printer **called the police.**`,
        ];

        // Randomly select a roast response
        const reply = responses[Math.floor(Math.random() * responses.length)];

        // Send the response mocking the message
        await interaction.reply({ content: reply });
    }
};
