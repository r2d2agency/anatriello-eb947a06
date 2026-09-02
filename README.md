# Anatriello

tenho uma vps em easypanel, e preciso de um sistema de envio de mensagens em lote vamos usar a evolution para conexao, preciso de uma frontend web para gestao, e vamos carregar listas de contatos em planilhas, nome, e telefone. 
entao vamos ter - 1 conexao, 
2 - Listas de contatos, 
3 - Mensagens
4 - data e hora que vai começar o envio, preciso que o envio seja programado e enviado com o tempo de espera entre uma mensagem e outra, ex. quero que envi as mensagens de modo aleatorio entre as 08 da manha ate as 18h em 2 dias . toda as dtas vao ser selecionadas. assim que selecionar o tempo de desparo, pausa aleatoria de 10 min. por exemplo pra noa perder o whatsapp, ai sim começa ou agenda o disparo. 
que pode ser acomanhada uma por uma. 

na mensagem quero poder ter uma variavel tipo {{nome}} e ele puxar o nome da pessoa que esta na lista e enviar 1 mensagem para cada pessoa. personalizada. 

quero poder visualizar a criação da mensagem que pode ter, Texto, imagem, videos, audios que serao previamente enviados. carregados. 

o sistema rodara tambem numa base em postgresql na vps da easypanel.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/db7922e6-608f-4e33-888b-c9c28c5517ea).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
