module.exports = function ValderonRewards(mod) {

    let valderonRewards = null;
    let inventory = {};
    const boxIds = [571, 572, 573];
    const boxGachaIds = { 571: 9287, 572: 9233, 573: 9238 };

    let boxQueue = [];
    let processingBox = false;
    let waitingForInventory = false;

    // --- Store Valderon rewards ---
    mod.hook('S_GUILD_QUEST_LIST', 2, (event) => {
        if (event.valderonRewards) valderonRewards = event.valderonRewards;
    });

    // --- Full inventory snapshot ---
    mod.hook('S_ITEMLIST', 4, (event) => {
        inventory = {};
        for (const item of event.items) {
            if (!inventory[item.id]) inventory[item.id] = [];
            inventory[item.id].push({ id: item.id, dbid: item.dbid, amount: item.amount });
        }

        if (waitingForInventory) {
            waitingForInventory = false;
            queueValderonBoxes();
        }
    });

    // --- Incremental inventory updates ---
    mod.hook('S_INVEN_USERDATA', 2, (event) => {
        const { item, amount, dbid } = event;
        if (amount > 0) {
            if (!inventory[item]) inventory[item] = [];
            const existing = inventory[item].find(it => it.dbid === dbid);
            if (existing) existing.amount = amount;
            else inventory[item].push({ id: item, dbid, amount });
        } else {
            if (inventory[item]) {
                inventory[item] = inventory[item].filter(it => it.dbid !== dbid);
                if (inventory[item].length === 0) delete inventory[item];
            }
        }
    });

    // --- Request inventory safely (force open all tabs) ---
    function requestInventory(callback) {
        waitingForInventory = true;
        let count = 0;
        function sendRequest() {
            if (count >= 3) {
                if (callback) callback();
                return;
            }
            mod.send('C_SHOW_ITEMLIST', 1, { unk: 0 });
            count++;
            setTimeout(sendRequest, 200);
        }
        sendRequest();
    }

    // --- !valderon command ---
    mod.command.add('valderon', () => {
        // Step 1: force open inventory
        requestInventory(() => {
            // Step 2: claim guild boxes
            if (valderonRewards) {
                for (const index of [0, 1, 2]) {
                    const reward = valderonRewards[index];
                    if (reward && reward.completed && !reward.received) {
                        mod.send('C_GET_GUILD_QUEST_WEEKLY_REWARD', 1, { index });
                    }
                }
            }

            // Step 3: refresh inventory after claiming
            setTimeout(() => requestInventory(), 500); // wait 500ms for server to process

            // Step 4: queue boxes after inventory refresh
            setTimeout(() => queueValderonBoxes(), 1000);
        });
    });

    // --- Queue boxes ---
    function queueValderonBoxes() {
        boxQueue = [];
        for (const boxId of boxIds) {
            const items = inventory[boxId];
            if (!items) continue;
            for (const item of items) {
                for (let i = 0; i < item.amount; i++) {
                    boxQueue.push(boxId);
                }
            }
        }

        if (!processingBox) processNextBox();
    }

    // --- Sequential box processing ---
    function processNextBox() {
        if (boxQueue.length === 0) {
            processingBox = false;
            return;
        }

        processingBox = true;
        const boxId = boxQueue.shift();
        const items = inventory[boxId];
        if (!items || items.length === 0) {
            processNextBox();
            return;
        }

        const item = items[0];

        setTimeout(() => {
            mod.send('C_USE_ITEM', 3, {
                gameId: mod.game.me.gameId,
                id: item.id,
                dbid: item.dbid,
                target: 0n,
                amount: 1,
                dest: 0,
                loc: mod.game.me.loc,
                w: mod.game.me.w,
                unk4: true
            });

            item.amount--;
            if (item.amount <= 0) {
                inventory[boxId].shift();
                if (inventory[boxId].length === 0) delete inventory[boxId];
            }

            setTimeout(() => {
                mod.send('C_GACHA_TRY', 2, {
                    id: boxGachaIds[boxId],
                    amount: 1
                });
            }, 200);

        }, 200);
    }

    // --- Handle gacha end ---
    mod.hook('S_GACHA_END', 3, () => {
        setTimeout(() => {
            mod.send('C_GACHA_CANCEL', 1, {});
            setTimeout(() => processNextBox(), 150);
        }, 200);
    });

    // --- Optional: /8 valderon ---
    mod.hook('C_CHAT', 1, (event) => {
        const msg = event.message.replace(/<.*?>/g, '').trim().toLowerCase();
        if (msg === 'valderon') mod.command.exec('valderon');
    });

};
