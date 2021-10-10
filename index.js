import Fastify from 'fastify'
import dotenv from 'dotenv';
import ethers from 'ethers'
import fetch from 'node-fetch';
import {execSync} from 'child_process'
import {readFileSync, writeFileSync} from 'fs'

dotenv.config()

// minimum difference between old and new cred to update the oracle
const MIN_CRED_DIFFERENTIAL = -1

const abi = JSON.parse(readFileSync('oracle-abi.json', {encoding: 'utf-8'}))
const idaAbi = JSON.parse(readFileSync('ida-abi.json', {encoding: 'utf-8'}))
const cortexAbi = JSON.parse(readFileSync('cortex-abi.json', {encoding: 'utf-8'}))
const wallet = new ethers.Wallet(process.env.SIGNER_PRIVATE_KEY, new ethers.providers.JsonRpcProvider(process.env.RPC_URL))
const oracle = new ethers.Contract(process.env.ORACLE_ADDRESS, abi, wallet)
const ida = new ethers.Contract(process.env.IDA_ADDRESS, idaAbi, wallet)
const cortex = new ethers.Contract(process.env.CORTEX_ADDRESS, cortexAbi, wallet)

const fastify = Fastify({
    logger: true
})

fastify.post('/', async (request, reply) => {
    console.log('Webhook received.')

    const feedLength = await oracle.getFeedLength()
    let [names, decimals, timeslots, revenueModes, costs] = await oracle.getFeedList(Array.from(Array(feedLength.toNumber()).keys()))

    execSync('rm -r cache', {cwd: '../sourcecred-test'})

    execSync('npx dotenv sourcecred go', {cwd: '../sourcecred-test'})
    const cachedIdentities = JSON.parse(readFileSync('cached-identities.json', {encoding: 'utf-8'}))
    const oldCredScores = JSON.parse(readFileSync('../sourcecred-test/credScores.json.old', {encoding: 'utf-8'}))
    const newCredScores = JSON.parse(readFileSync('../sourcecred-test/output/credScores.json', {encoding: 'utf-8'}))

    const feedsToCreate = []
    const scoresToPost = []

    for (const identity of Object.keys(newCredScores)) {
        console.log()

        const oldCredScore = oldCredScores[identity];
        const newCredScore = newCredScores[identity];

        console.log(`${identity}: ${oldCredScore} -> ${newCredScore}`)
        if (newCredScore - oldCredScore > MIN_CRED_DIFFERENTIAL || oldCredScore - newCredScore > MIN_CRED_DIFFERENTIAL) {
            console.log('Minimum cred differential exceeded, posting new score to oracle.')

            if (cachedIdentities[identity] !== undefined) {
                const address = cachedIdentities[identity];

                console.log(`Posting new score for address ${address}.`)
                scoresToPost.push({ address: address, score: ethers.utils.parseEther(newCredScore.toString()) })

                const matchingFeedId = names.indexOf(cachedIdentities[identity])

                if (matchingFeedId === -1) {
                    console.log('Didn\'t find feed in oracle, creating new feed for account.')
                    feedsToCreate.push(address)
                } else {
                    console.log('Found address in feed list.')
                }
            }
            else {
                console.log(`Cached identity not found for ${identity}. Trying to verify...`)

                const proofRequest = await fetch(`https://api.github.com/repos/${identity}/${identity}/contents/ethereum-proof.json`)
                if (proofRequest.status !== 200) {
                    console.log('Couldn\'t find a proof in user\'s personal repo.')
                }
                else {
                    const apiResponse = await proofRequest.json();
                    const proofJson = Buffer.from(apiResponse['content'], 'base64')
                    const {payload, signature} = JSON.parse(proofJson.toString('utf-8'))
                    const {ethereumAddress, githubUsername} = JSON.parse(payload)
                    const signatureValid = (ethers.utils.verifyMessage(payload, signature) === ethereumAddress) && (identity === githubUsername)

                    if (signatureValid) {
                        console.log('Signature validated.')

                        cachedIdentities[githubUsername] = ethereumAddress
                        scoresToPost.push({ address: ethereumAddress, score: newCredScore })

                        const matchingFeedId = names.indexOf(ethereumAddress)

                        if (matchingFeedId === -1) {
                            console.log('Didn\'t find feed in oracle, creating new feed for account.')
                            feedsToCreate.push(ethereumAddress)
                        } else {
                            console.log('Found address in feed list.')
                        }
                    } else {
                        console.log('Signature invalid.')
                    }
                }
            }
        }
    }

    writeFileSync('cached-identities.json', JSON.stringify(cachedIdentities))

    if (feedsToCreate.length > 0) {
    console.log(`Creating ${feedsToCreate.length} new feeds...`)
    await oracle.createNewFeeds(
        feedsToCreate,
        Array(feedsToCreate.length).fill(''),
        Array(feedsToCreate.length).fill(18),
        Array(feedsToCreate.length).fill(1),
        Array(feedsToCreate.length).fill(0),
        Array(feedsToCreate.length).fill(0),
    )
    } else {
        console.log('Skipping feed creation.')
    }

    console.log(`Posting ${scoresToPost.length} new scores...`)
    const response = await oracle.getFeedList(Array.from(Array(feedLength.toNumber()).keys()))
    names = response[0]
    const feedIds = scoresToPost.map(score => names.indexOf(score.address))
    const scores = scoresToPost.map(score => score.score)
    await oracle.submitFeed(feedIds, scores)

    execSync('cp output/credScores.json credScores.json.old', {cwd: '../sourcecred-test'})
    reply.send()
})

fastify.get('/download', async(request, response) => {
    const purchased = (await cortex.getPurchased("0x07158265D3fA6EC45085BA452F9D25E85319d155"))
    const downloadLink = "https://bafybeiboiadilkzvcmrlo3hlfazi5arnx2ttitag7mcgu3c7p4rd7ojaku.ipfs.dweb.link/my_amazing_book.txt"

    if (purchased) {
        return downloadLink
    }
    else {
        return downloadLink
    }
})

fastify.get('/dashboard', async (request, response) => {
    const feedLength = await oracle.getFeedLength()
    const [names, decimals, timeslots, revenueModes, costs] = await oracle.getFeedList(Array.from(Array(feedLength.toNumber()).keys()))

    const payload = {}
    const credScores = JSON.parse(readFileSync('../sourcecred-test/credScores.json.old', {encoding: 'utf-8'}))
    const cachedIdentities = JSON.parse(readFileSync('cached-identities.json', {encoding: 'utf-8'}))

    for (let [identity, score] of Object.entries(credScores)) {
        payload[identity] = { score: score }
    }

    for (let [identity, address] of Object.entries(cachedIdentities)) {
        payload[identity]["address"] = address
    }

    for (let [identity, address] of Object.entries(cachedIdentities)) {
        const pending = (await ida.getSubscription(
            "0x745861AeD1EEe363b4AaA5F1994Be40b1e05Ff90",
            process.env.CORTEX_ADDRESS,
            1,
            address
        )).pendingDistribution

        payload[identity]["pending"] = parseFloat(ethers.utils.formatEther(pending))
    }

    return payload
})

fastify.listen(8000, (err, address) => {
    if (err) throw err
})