// index.tsx — command-quota 入口
import { Navigation, Script } from 'scripting'
import { Page } from './page'

async function run() {
  await Navigation.present(<Page />)
  Script.exit()
}

run()
