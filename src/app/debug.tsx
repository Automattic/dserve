import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import * as Dockerode from 'dockerode';
import * as os from 'os';

import { ONE_MINUTE } from '../api';
import { Shell } from './app-shell';
import { promiseRejections } from '../index';
import { humanSize, humanTime, percent, round } from './util';

import { state as apiState } from '../api';
import { BUILD_QUEUE } from '../builder';

const Docker = new Dockerode();

const Debug = (c: RenderContext) => {
    const memUsage = process.memoryUsage();
    const heapU = memUsage.heapUsed;
    const heapT = memUsage.heapTotal;
    const memTotal = os.totalmem();
    const memUsed = memTotal - os.freemem();
    const images = Array.from(apiState.localImages.entries()) as Array<[string, Dockerode.ImageInfo]>;

    const shortHash = (hash: string, length = 30) => <span title={hash}>{hash.slice(0, length)}…</span>;

    return (
        <Shell refreshInterval={ONE_MINUTE} startedServerAt={c.startedServerAt}>
            <style
                dangerouslySetInnerHTML={{
                    __html: `
                    .dserve-debug-cards {
                        display: flex;
                        flex-direction: row;
                        align-content: flex-start;
                        justify-content: flex-start;
                        flex-wrap: wrap;
                    }

                    .dserve-debug-cards figure {
                        border: 1px solid gray;
                        border-radius: 4px;
                        padding: 8px;
                        margin: auto;
                        margin-bottom: 16px;
                    }

                    .dserve-debug-cards figure figcaption {
                        border: 1px solid gray;
                        border-radius: 2px;
                        padding: 4px;
                        display: inline;
                    }

                    .dserve-debug-cards strong {
                        color: #00d8ff;
                    }
                    `,
                }}
            />
            <div className="dserve-debug-cards">
                <figure>
                    <p>CPU (x{os.cpus().length}): {os.loadavg().map(a => round(a, 2)).join(', ')} (1m, 5m, 15m)</p>
                    <p>Memory</p>
                    <ul>
                        <li>heap: {humanSize(heapU)} / {humanSize(heapT)} ({percent(heapU, heapT)}%)</li>
                        <li>system: {humanSize(memUsed)} / {humanSize(memTotal)} ({percent(memUsed, memTotal)}%)</li>
                    </ul>
                    <figcaption>System Load</figcaption>
                </figure>

                <figure>
                    <p>Build Queue</p>
                    {BUILD_QUEUE.length ? (
                        <ul>
                            {BUILD_QUEUE.map(hash => <li>{hash}</li>)}
                        </ul>
                    ) : (
                            <p><em>Nothing is waiting in the queue</em></p>
                        )}
                    <figcaption>Builder</figcaption>
                </figure>

                <figure>
                    {promiseRejections.size ? (
                        <ul>
                            {Array.from(promiseRejections.values()).map(([ts, reason,]) => (
                                <li>
                                    <time dateTime={ts.toISOString()} title={ts.toLocaleTimeString(undefined, { timeZoneName: 'long', hour12: true })}>
                                        {humanTime(ts.getTime() / 1000)}
                                    </time>
                                    {reason}
                                </li>
                            ))}
                        </ul>
                    ) : (
                            <p><em>No unhandled rejected promises</em></p>
                        )}
                    <figcaption>Rejected Promises</figcaption>
                </figure>

                <figure>
                    <p>Containers</p>
                    <ul>
                        {Array.from(apiState.containers.entries()).map(([key, value]) => (
                            <li key={value.Id}>
                                <strong>{value.Names}</strong> - {shortHash(value.Id)}<br />Image ID: {shortHash(value.ImageID)}<br />Status: {value.Status}
                            </li>
                        ))}
                    </ul>

                    <p>Images</p>
                    <p>Total storage size: {humanSize(images.reduce((size, [, info]) => size + info.Size, 0))}</p>
                    <ul>
                        {images.map(([key, value]) => (
                            <li key={value.Id}>
                                RepoTags: <strong>{shortHash(value.RepoTags.join(', '), 38)}</strong><br />Id: {shortHash(value.Id)}<br />Size: {humanSize(value.Size)}
                            </li>
                        ))}
                    </ul>

                    <figcaption>API</figcaption>
                </figure>

                <figure>
                    <p>Containers</p>
                    <ul>
                        {(
                            c.docker.containers
                                .sort((a, b) => a.Names[0].localeCompare(b.Names[0]))
                                .map(info => <li key={info.Id}><strong>{info.Names}</strong> - {shortHash(info.Id)}<br />Image ID: {shortHash(info.ImageID)}<br />Status: {info.Status}</li>)
                        )}
                    </ul>

                    <p>Images</p>
                    <ul>
                        {(
                            c.docker.images
                                .sort((a, b) => a.RepoTags[0].localeCompare(b.RepoTags[0]))
                                .map(info => <li key={info.Id}>RepoTags: <strong>{shortHash(info.RepoTags.join(', '), 38)}</strong><br />Id: {shortHash(info.Id)}</li>)
                        )}
                    </ul>
                    <figcaption>Docker</figcaption>
                </figure>
            </div>
        </Shell>
    );
};

type RenderContext = {
    startedServerAt: Date;
    docker: {
        containers: Array<Dockerode.ContainerInfo>;
        images: Array<Dockerode.ImageInfo>;
    };
}

export default async function renderDebug({ startedServerAt }: { startedServerAt: Date }) {
    return ReactDOMServer.renderToStaticMarkup((
        <Debug
            startedServerAt={startedServerAt}
            docker={{
                containers: await Docker.listContainers(),
                images: await Docker.listImages(),
            }}
        />
    ));
}
